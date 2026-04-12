// parser_browser.js (先頭部分)
import operators from './operators.js';
import lexer from './prepare_lexer.js';

const { parseTable, semantics } = operators;

// --- AST Nodes ---
const createNode = (type, value, children = []) => ({ type, value, children });

// --- Operators ---

const ops = [
	{ symbol: "#", precedence: 1, notation: "prefix" }, // export
	{ symbol: "##", precedence: 1, notation: "prefix" },
	{ symbol: "###", precedence: 1, notation: "prefix" },
	{ symbol: ":", precedence: 2, notation: "infix", associativity: "right" },
	{ symbol: "#", precedence: 3, notation: "infix", associativity: "left" },
	// APPLY (Space) is precedence 4
	{ symbol: "?", precedence: 5, notation: "infix", associativity: "right" },
	{ symbol: ",", precedence: 6, notation: "infix", associativity: "right" },
	// Push/Concat (7) and Compose (8) handled by space context in normalizer
	{ symbol: "~", precedence: 9, notation: "infix", associativity: "left" }, // Range around
	{ symbol: "~+", precedence: 9, notation: "infix", associativity: "left" },
	{ symbol: "~-", precedence: 9, notation: "infix", associativity: "left" },
	{ symbol: "~*", precedence: 9, notation: "infix", associativity: "left" },
	{ symbol: "~/", precedence: 9, notation: "infix", associativity: "left" },
	{ symbol: "~^", precedence: 9, notation: "infix", associativity: "left" },
	{ symbol: "~", precedence: 10, notation: "prefix", associativity: "right" }, // Continuous
	{ symbol: ";", precedence: 11, notation: "infix", associativity: "left" }, // Logic XOR
	{ symbol: "|", precedence: 12, notation: "infix", associativity: "left" }, // Logic OR
	{ symbol: "&", precedence: 13, notation: "infix", associativity: "left" }, // Logic AND
	{ symbol: "!", precedence: 14, notation: "prefix", associativity: "right" }, // Logic Not
	{ symbol: "<", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: "<=", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: "=", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: "==", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: ">=", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: ">", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: "!=", precedence: 15, notation: "infix", associativity: "left" },
	{ symbol: "+", precedence: 16, notation: "infix", associativity: "left" },
	{ symbol: "-", precedence: 16, notation: "infix", associativity: "left" },
	{ symbol: "*", precedence: 17, notation: "infix", associativity: "left" },
	{ symbol: "/", precedence: 17, notation: "infix", associativity: "left" },
	{ symbol: "%", precedence: 17, notation: "infix", associativity: "left" },
	{ symbol: "^", precedence: 18, notation: "infix", associativity: "right" }, // Pow
	{ symbol: "!", precedence: 19, notation: "postfix", associativity: "left" }, // Factorial
	{ symbol: "~", precedence: 21, notation: "postfix", associativity: "left" }, // Expand
	{ symbol: "'", precedence: 22, notation: "infix", associativity: "left" }, // Get
	{ symbol: "@", precedence: 23, notation: "infix", associativity: "left" }, // At
	{ symbol: "$", precedence: 24, notation: "prefix", associativity: "right" }, // Address
	{ symbol: "@", precedence: 24, notation: "prefix", associativity: "right" }, // Input
	{ symbol: "<<", precedence: 25, notation: "infix", associativity: "left" },
	{ symbol: ">>", precedence: 25, notation: "infix", associativity: "left" },
	{ symbol: "||", precedence: 26, notation: "infix", associativity: "left" },
	{ symbol: ";;", precedence: 27, notation: "infix", associativity: "left" },
	{ symbol: "&&", precedence: 28, notation: "infix", associativity: "left" },
	{ symbol: "!!", precedence: 29, notation: "prefix", associativity: "right" }, // Bit Not
	{ symbol: "@", precedence: 30, notation: "postfix", associativity: "left" }, // Import
	{ symbol: "\\", precedence: 33, notation: "prefix", associativity: "right" } // Escape
];

const findOp = (symbol, notation) => {
	return ops.find(op => op.symbol === symbol && op.notation === notation);
};

// Check if a string is a known operator symbol
const isOpSymbol = (str) => ops.some(op => op.symbol === str);

const refineTokens = (rawTokens) => {
	const refined = [];
	for (const token of rawTokens) {
		if (Array.isArray(token)) {
			refined.push(refineTokens(token));
		} else {
			refined.push(token); // Separators (\n, etc.) and raw strings
		}
	}
	return refined;
};

// --- Parser ---

const isSeparator = (token) => token && typeof token === 'object' && token.type === 'separator';

const APPLY_PREC = 4;

const parseExpr = (tokens, minPrec = 0) => {
	if (tokens.length === 0) return null;
	let peak = tokens[0];

	if (isSeparator(peak)) {
		return null;
	}

	// Helper to check if a token can start an expression
	const canStartExpr = (token) => {
		if (!token) return false;
		if (Array.isArray(token)) return true; // Block

		if (typeof token === 'string') {
			if (token.startsWith('`')) return true; // String
			if (token.startsWith('\\')) return true; // Char
			if (!isNaN(parseFloat(token)) && isFinite(token)) return true; // Number

			// Does it start with a prefix operator? Or is it an identifier?
			// Even if it starts with an operator, if that operator is Prefix, it CAN start an expr.
			// If it's pure operator string but NOT a prefix, it cannot start.
			// Actually, almost any string can start an expr (either as id, number, or prefix op + id).
			// The only things that CANNOT start an expr are literal infix/postfix operators standing alone.
			if (isOpSymbol(token)) {
				return !!findOp(token, 'prefix');
			}

			// If it's a mixed string starting with operator characters, check if they form a prefix op
			const opMatch = token.match(/^([!#$%&'*+,\-./:;<=>?@^|~\\]+)/);
			if (opMatch) {
				const pre = opMatch[1];
				// Even if it's not a known prefix, if it's attached to an identifier, we might treat it as prefix or parse error later, but it "starts" something.
				// For canStartExpr, let's assume if it has non-op chars, it's a valid starter (prefix + id).
				if (pre.length < token.length) return true;
			}

			return true; // Identifier
		}
		return false;
	};

	let lhs = parseAtom(tokens);
	if (!lhs) return null;

	while (tokens.length > 0) {
		let lookahead = tokens[0];

		// Special handling for ambiguous `|`
		if (lookahead === '|') {
			// ★修正: 最後のトークンである場合(length === 1)も閉じ括弧として扱う
			if (tokens.length === 1 || !canStartExpr(tokens[1])) {
				break; // Terminator
			}
		}

		if (isSeparator(lookahead)) {
			let sepCount = 0;
			while (sepCount < tokens.length && isSeparator(tokens[sepCount])) sepCount++;
			if (sepCount < tokens.length) {
				const nextOpTok = tokens[sepCount];
				if (typeof nextOpTok === 'string' && isOpSymbol(nextOpTok)) {
					const opInfo = findOp(nextOpTok, 'infix') || findOp(nextOpTok, 'postfix');
					if (opInfo && opInfo.precedence >= minPrec && !canStartExpr(nextOpTok)) {
						tokens.splice(0, sepCount);
						lookahead = tokens[0];
					} else {
						break;
					}
				} else {
					break;
				}
			} else {
				break;
			}
		}

		let is_op = false;
		let opSymbol = null;
		let is_post_or_in = false;

		if (typeof lookahead === 'string') {
			// Extract postfix or infix operator from the token if possible
			// If it's an exact match:
			if (isOpSymbol(lookahead)) {
				is_op = true;
				opSymbol = lookahead;
			} else {
				// Check if the token STARTS with an infix/postfix operator that can be peeled?
				// No, Infix/Postfix operators must either be space-separated OR attached at the END.
				// For Zero Cost Domain Abstraction, operators are space separated!
				// Wait! If they are space separated, we shouldn't peel them from the *ends* either?
				// User said: "構文解析器自身が、渡ってきた文字列を見て「先頭が前置演算子であるか」「末尾が後置演算子であるか」「単独の記号（中置演算子）であるか」を動的に判定し、その場で文字列をスライスして"
				// OK, so we peel dynamically.

				// Postfix Check: Can we peel a postfix operator from the end?
				// Wait, if it's "a!", '!' is at the end.
				// Infix check: Can we peel an infix operator from the START?
				// No, infix shouldn't really be peeled if attached, unless it's a macro or something.
				// "空白で区切られた生の文字列トークンがそのまま渡ってくる前提"
				// "先頭が前置演算子であるか、末尾が後置演算子であるか" -> Only Prefix and Postfix are attached!
				// 中置演算子は "単独の記号" であるか。
			}
		}

		// If lookahead is a pure string ending with a postfix operator, we should peel it.
		if (typeof lookahead === 'string' && !is_op) {
			const postMatch = lookahead.match(/([!#$%&'*+,\-./:;<=>?@^|~\\]+)$/);
			if (postMatch) {
				const postStr = postMatch[1];
				// Find the longest valid postfix op
				let foundPost = null;
				let foundLen = 0;
				for (let len = postStr.length; len > 0; len--) {
					const sub = postStr.slice(-len);
					if (findOp(sub, 'postfix')) {
						foundPost = sub;
						foundLen = len;
						break;
					}
				}

				if (foundPost) {
					// We found a postfix operator at the end of the token.
					// We must split the token into two: (token without postfix) and (postfix)
					// But wait! If we do this here, we are looking ahead AFTER an expression. 
					// Actually, the left expression (lhs) has *already* consumed the token without the postfix?
					// No, if `a!` is a single token, `parseAtom` would see it.
					// Ah! So `parseAtom` should also handle peeling postfix?
					// No, if `a!` is one token, `parseAtom` sees `a!`. It should peel `a` as Identifier, and leave `!` in `tokens`!
					// Yes, `parseAtom` should consume the prefix/body, and push the postfix back to `tokens` *before* returning!
					// So `parseExpr`'s lookahead will just see single operator strings for infix/postfix!
				}
			}
		}

		if (typeof lookahead === 'string' && isOpSymbol(lookahead)) {
			opSymbol = lookahead;

			// 中置/後置としてパースできるかチェック
			let op = findOp(opSymbol, 'postfix') || findOp(opSymbol, 'infix');

			if (!op) {
				break; // Not infix/postfix, so it must be applying it as an argument
			}

			// Do not consume if precedence is lower
			if (op.precedence < minPrec) break;

			// Consumed token
			tokens.shift();

			if (op.notation === 'postfix') {
				lhs = { type: 'postfix', op: opSymbol, expr: lhs };
				continue;
			}

			// Automatic Currying Logic for '?'
			if (opSymbol === '?') {

				// Helper: Create a lambda, handling Default Arguments (infix :)
				const makeLambda = (arg, body) => {
					// Handle Default Argument: arg is { type: 'infix', op: ':', left: param, right: defaultVal }
					if (arg.type === 'infix' && arg.op === ':') {
						const param = arg.left;
						const defaultVal = arg.right;
						const tempParamName = '$temp_' + (param.value || 'arg');

						// wrapper block: [ param : tempParam | defaultVal; body... ]

						let newBodyStatements = [];

						// Definition expr: param : tempParam | defaultVal
						const defExpr = {
							type: 'infix', op: ':',
							left: param,
							right: {
								type: 'infix', op: '|', // Logical OR
								left: { type: 'identifier', value: tempParamName },
								right: defaultVal
							}
						};
						newBodyStatements.push(defExpr);

						// Add original body
						if (body.type === 'block') {
							newBodyStatements.push(...body.body);
						} else {
							newBodyStatements.push(body);
						}

						const wrappedBody = {
							type: 'block',
							body: newBodyStatements
						};

						// Return: tempParam ? wrappedBody
						return {
							type: 'infix',
							op: '?',
							left: { type: 'identifier', value: tempParamName },
							right: wrappedBody
						};
					}

					// Standard Lambda
					return {
						type: 'infix',
						op: '?',
						left: arg,
						right: body
					};
				};

				// Recursive helper to transform apply chains and blocks into curried functions
				const curry = (expr, body) => {
					if (expr.type === 'apply') {
						// With default args: f ? makeLambda(a, body)
						return curry(expr.func, makeLambda(expr.arg, body));
					}

					// Support [arg1 arg2] ? body -> arg1 ? (arg2 ? body)
					if (expr.type === 'block') {
						let result = body;
						const args = expr.body;
						// If block is empty? [ ] ? body -> body
						if (args.length === 0) return body;

						for (let i = args.length - 1; i >= 0; i--) {
							result = curry(args[i], result);
						}
						return result;
					}

					// Base case
					return makeLambda(expr, body);
				};


				const nextMinPrec = op.associativity === 'right' ? op.precedence : op.precedence + 1;
				const rhs = parseExpr(tokens, nextMinPrec);

				// Rewrite Rule for Definition: f : args ? body -> f : (args ? body)
				// Because ':' has higher precedence than '?', 'f : args' is parsed as LHS.
				if (lhs.type === 'infix' && lhs.op === ':') {
					const defName = lhs.left;
					const defArgs = lhs.right;
					const curried = curry(defArgs, rhs);
					lhs = { type: 'infix', op: ':', left: defName, right: curried };
				} else {
					lhs = curry(lhs, rhs);
				}

				continue;
			}

			const nextMinPrec = op.associativity === 'right' ? op.precedence : op.precedence + 1;
			const rhs = parseExpr(tokens, nextMinPrec);
			lhs = { type: 'infix', op: opSymbol, left: lhs, right: rhs };
			continue;
		}

		if (isSeparator(lookahead) || lookahead === '|') break;

		// Apply
		if (APPLY_PREC < minPrec) break;

		if (isSeparator(lookahead) || lookahead === '|') break;

		const rhsAtom = parseExpr(tokens, APPLY_PREC + 1);
		if (rhsAtom) {
			lhs = { type: 'apply', func: lhs, arg: rhsAtom };
		} else {
			break;
		}
	}

	return lhs;
};

const parseAtom = (tokens) => {
	const token = tokens.shift();
	if (!token) return null;

	if (Array.isArray(token)) {
		const blockAst = parseBlock(token);

		// ⚡ 修正: カンマ結合(リスト)やブロックの場合、カッコの境界情報として group ノードでラップする
		// これにより [5, 6] が外側のリストと同化(フラット化)するのを完全に防ぎます。
		// ※セクション構文(ラムダ)や単独の演算はラップせず通すため、パイプライン等は壊れません！
		if (blockAst && (blockAst.type === 'block' || (blockAst.type === 'infix' && blockAst.op === ','))) {
			return { type: 'group', body: blockAst };
		}

		return blockAst;
	}

	if (typeof token !== 'string') {
		return { type: 'unknown', token };
	}

	let value = token;

	// Absolute value operator | ... |
	if (value === '|') {
		const expr = parseExpr(tokens, 0);
		tokens.shift(); // Consume the closing |
		return { type: 'abs', expr };
	}

	// 1. Literal evaluation
	if (value.startsWith('`')) {
		return { type: 'string', value: value };
	}

	if (value.startsWith('\\')) {
		return { type: 'char', value: value.slice(1) };
	}

	// ⚡修正：parseFloatによる 0x 等の誤変換を防ぐため、N進数/文字接頭辞のパースを先に行う
	if (value.startsWith('0x') || value.startsWith('0r')) {
		return { type: 'number', value: parseInt(value.slice(2), 16) };
	}
	if (value.startsWith('0b')) {
		return { type: 'number', value: parseInt(value.slice(2), 2) };
	}
	if (value.startsWith('0o')) {
		return { type: 'number', value: parseInt(value.slice(2), 8) };
	}
	if (value.startsWith('0u')) {
		return { type: 'char', value: parseInt(value.slice(2), 16) };
	}

	// 通常の10進数
	if (!isNaN(parseFloat(value)) && isFinite(value)) {
		return { type: 'number', value: parseFloat(value) };
	}

	// 2. Pure Operator String (Standalone)
	if (isOpSymbol(value)) {
		const op = findOp(value, 'prefix');
		if (op) {
			// Prefix operator evaluation
			const rhs = parseExpr(tokens, op.precedence);
			return { type: 'prefix', op: value, expr: rhs };
		}
		// If it's a standalone symbol but not a prefix, return as identifier (e.g. for functions)
		return { type: 'identifier', value: value, isOp: true };
	}

	// 3. Mixed token processing (Dynamic Splitting)
	// Peel off ALL prefix operators one by one from left to right.
	const preMatch = value.match(/^([!#$%&'*+,\-./:;<=>?@^|~\\]+)/);
	if (preMatch) {
		const preStr = preMatch[1];
		let remainingPre = preStr;
		let foundPrefixes = [];

		while (remainingPre.length > 0) {
			let found = false;
			for (let len = remainingPre.length; len > 0; len--) {
				const sub = remainingPre.slice(0, len);
				if (findOp(sub, 'prefix')) {
					foundPrefixes.push(sub);
					remainingPre = remainingPre.slice(len);
					found = true;
					break;
				}
			}
			if (!found) {
				// No valid prefix op matched. Treat as rest of identifier?
				// But strings of symbols should either be valid operators or identifiers.
				// If a prefix fails to parse, we exit pre-peeling.
				break;
			}
		}

		if (foundPrefixes.length > 0) {
			// Calculate how much of the original string to keep as the "rest"
			const strippedLen = preStr.length - remainingPre.length;
			const restOfToken = value.slice(strippedLen);

			if (restOfToken.length > 0) {
				// Push the rest of the token back onto the stream to be parsed NEXT.
				tokens.unshift(restOfToken);
			}

			// Unshift the remaining prefixes so they can be parsed by `parseExpr` successively
			for (let i = foundPrefixes.length - 1; i > 0; i--) {
				tokens.unshift(foundPrefixes[i]);
			}

			const firstPrefix = foundPrefixes[0];
			const opPrecedence = findOp(firstPrefix, 'prefix').precedence;

			// Recursively call parseExpr to build the AST for the rest.
			const rhs = parseExpr(tokens, opPrecedence);
			return { type: 'prefix', op: firstPrefix, expr: rhs };
		}
	}

	// 4. Peel postfix operators from the end
	const postMatch = value.match(/([!#$%&'*+,\-./:;<=>?@^|~\\]+)$/);
	if (postMatch) {
		const postStr = postMatch[1];
		let remainingPost = postStr;
		let foundPostfixes = [];

		while (remainingPost.length > 0) {
			let found = false;
			for (let len = remainingPost.length; len > 0; len--) {
				const sub = remainingPost.slice(-len);
				if (findOp(sub, 'postfix')) {
					foundPostfixes.unshift(sub); // Add to front of list
					remainingPost = remainingPost.slice(0, -len);
					found = true;
					break;
				}
			}
			if (!found) break;
		}

		if (foundPostfixes.length > 0) {
			const strippedLen = postStr.length - remainingPost.length;
			const bodyToken = value.slice(0, value.length - strippedLen);

			if (bodyToken.length > 0) {
				// Push the postfixes back onto the stream to be parsed by parseExpr loop
				for (const pst of foundPostfixes) {
					tokens.unshift(pst);
				}
				// The body is treated as the atom
				return { type: 'identifier', value: bodyToken };
			}
			// If body is empty, it was pure postfixes? That's handled in pure operator section
		}
	}

	return { type: 'identifier', value: value };
};

const parseBlock = (tokens) => {
	// Check for Operator Section pattern in a "Block" (Array)
	// [ + 1 ] -> ($1 ? $1 + 1)
	// [ 1 + ] -> ($1 ? 1 + $1)
	// [ + ]   -> ($1 ? $2 ? $1 + $2)

	// Filter separators for analysis
	const cleanTokens = tokens.filter(t => !isSeparator(t));

	// -------------------------------------------------------------------
	// ブロックの先頭と末尾が両方 `|` なら「絶対値」なので、セクション判定から除外する
	const isAbsoluteValueBlock = cleanTokens.length >= 2
		&& cleanTokens[0] === '|'
		&& cleanTokens[cleanTokens.length - 1] === '|';
	// -------------------------------------------------------------------

	const exprs = [];
	const blockTokens = [...tokens];

	const isSectionOp = (t) => typeof t === 'string' && isOpSymbol(t);

	// Try to detect section
	// 1. [ op ]
	if (cleanTokens.length === 1 && isSectionOp(cleanTokens[0])) {
		const opStr = cleanTokens[0];

		// 動的判定を削除し、純粋な関数 `$1 ? $2 ? $1 op $2` として展開
		return {
			type: 'infix', op: '?',
			left: { type: 'identifier', value: '$1' },
			right: {
				type: 'infix', op: '?',
				left: { type: 'identifier', value: '$2' },
				right: {
					type: 'infix', op: opStr,
					left: { type: 'identifier', value: '$1' },
					right: { type: 'identifier', value: '$2' }
				}
			}
		};
	}

	// 2. [ op expr ] (Right Section: [+ 1] -> $1 + 1)
	if (!isAbsoluteValueBlock && cleanTokens.length >= 2 && isSectionOp(cleanTokens[0])) {
		const opStr = cleanTokens[0];
		if (findOp(opStr, 'infix')) {
			// Parse the rest as expr
			const content = [...tokens];
			// remove leading separators until op
			while (content.length > 0 && isSeparator(content[0])) content.shift();
			content.shift(); // remove op

			// 演算子と値の間の空白(separator)を消す
			while (content.length > 0 && isSeparator(content[0])) content.shift();

			const rhs = parseExpr(content);
			if (rhs && content.every(t => isSeparator(t))) {
				// 純粋な関数 `$1 ? $1 op rhs` として展開
				return {
					type: 'infix', op: '?',
					left: { type: 'identifier', value: '$1' },
					right: {
						type: 'infix', op: opStr,
						left: { type: 'identifier', value: '$1' },
						right: rhs
					}
				};
			}
		}
	}

	// 3. [ expr op ] (Left Section: [1 +] -> 1 + $1)
	if (!isAbsoluteValueBlock && cleanTokens.length >= 2 && isSectionOp(cleanTokens[cleanTokens.length - 1])) {
		const opStr = cleanTokens[cleanTokens.length - 1];
		if (findOp(opStr, 'infix')) {
			const content = [...tokens];
			while (content.length > 0 && isSeparator(content[content.length - 1])) content.pop();
			const last = content.pop(); // Op

			// 値と演算子の間の空白(separator)を消す
			while (content.length > 0 && isSeparator(content[content.length - 1])) content.pop();

			if (last === opStr) {
				const lhs = parseExpr(content);
				if (lhs && content.every(t => isSeparator(t))) {
					// 純粋な関数 `$1 ? lhs op $1` として展開
					return {
						type: 'infix', op: '?',
						left: { type: 'identifier', value: '$1' },
						right: {
							type: 'infix', op: opStr,
							left: lhs,
							right: { type: 'identifier', value: '$1' }
						}
					};
				}
			}
		}
	}

	// セクション構文でない通常のブロックのパース
	while (blockTokens.length > 0) {
		if (isSeparator(blockTokens[0])) {
			blockTokens.shift();
			continue;
		}

		const expr = parseExpr(blockTokens);
		if (expr) {
			exprs.push(expr);
		} else {
			if (blockTokens.length > 0) blockTokens.shift();
		}
	}

	// ----------------------------------------------------
	let result;
	if (exprs.length === 0) result = { type: 'unit' };
	else if (exprs.length === 1) {
		// ★ 修正: 1要素であっても、それがペア/代入(:)である場合は、
		// 辞書(A-List)のコンテキストを維持するためにブロックの殻を破棄しない
		if (exprs[0] && exprs[0].type === 'infix' && exprs[0].op === ':') {
			result = { type: 'block', body: exprs };
		} else {
			result = exprs[0];
		}
	}
	else result = { type: 'block', body: exprs };

	return result;
};

// --- Main ---
// ↓ 既存の process.argv や fs.readFileSync の部分を丸ごと以下の関数に置き換えます

export function parseSign(code) {
	// ファイル操作は行わず、純粋に文字列からASTを生成して返します
	const rawRoot = lexer.parseToSExpr(code);
	const refinedRoot = refineTokens(rawRoot);
	let ast = parseBlock(refinedRoot);

	// ★ 追加: トップレベルが単一の文だった場合、コンパイラがバインディングを処理できるよう強制的にブロックでラップする
	if (ast && ast.type !== 'block') {
		ast = { type: 'block', body: [ast] };
	}

	return ast;
}