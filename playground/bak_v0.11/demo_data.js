// demo_data.js

// ==========================================
// UI共通テキスト
// ==========================================
export const uiText = {
	ja: {
		title: "Sign Playground",
		toggleRef: "リファレンス表示切替",
		github: "GitHub Docs ↗",
		sampleDefault: "-- サンプルを選択 --",
		runBtn: "▶ コンパイル & 実行",
		codeLabel: "Sign Code:",
		watLabel: "Generated WAT",
		outputLabel: "Execution Result",
		footerNote: "※ 構文解析結果(AST)はブラウザの開発者ツール(F12)のコンソールに出力されます。"
	},
	en: {
		title: "Sign Playground",
		toggleRef: "Toggle Reference",
		github: "GitHub Docs ↗",
		sampleDefault: "-- Select a Sample --",
		runBtn: "▶ Compile & Run WASM",
		codeLabel: "Sign Code:",
		watLabel: "Generated WAT",
		outputLabel: "Execution Result",
		footerNote: "* AST (Abstract Syntax Tree) is logged to the browser console (F12)."
	}
};

// ==========================================
// サンプルコードの定義
// ==========================================
export const samples = {
	hello: {
		name: { ja: "Hello Sign", en: "Hello Sign" },
		code: {
			ja: "`文字列を括弧で囲むことで、コメントではなく式として評価させます`\n(`Hello, Sign World!`)",
			en: "`Wrap strings in parentheses to evaluate them as expressions instead of comments`\n(`Hello, Sign World!`)"
		}
	},
	math: {
		name: { ja: "四則演算 (通常パターン)", en: "Basic Math" },
		code: {
			ja: "`通常の四則演算です。演算子の優先順位や括弧による評価順の制御が機能します`\n(10 + 20) * 3",
			en: "`Basic arithmetic. Operator precedence and parentheses work as expected`\n(10 + 20) * 3"
		}
	},
	list: {
		name: { ja: "リストの生成", en: "List Generation" },
		code: {
			ja: "`コンスセルベースのリスト生成です。カンマで階層を作ったり、ブラケットで平坦化できます`\n[1 2 3] , [4 5]",
			en: "`Cons-cell based lists. Commas create depth, brackets flatten the list`\n[1 2 3] , [4 5]"
		}
	},
	lambda: {
		name: { ja: "無名関数 (即時実行)", en: "Inline Lambda" },
		code: {
			ja: "`無名関数（ラムダ）を括弧で囲み、続けて引数を渡すことで即時実行できます`\n[x ? x * 2] 10",
			en: "`Wrap an anonymous function in brackets and pass an argument to execute it immediately`\n[x ? x * 2] 10"
		}
	},
	pointfree: {
		name: { ja: "ポイントフリー (Fold/Map)", en: "Point-free (Fold/Map)" },
		code: {
			ja: "`パイプラインとリスト操作を組み合わせたポイントフリースタイルの記述です`\n`リストの各要素を2倍して、その合計を求めます`\n[* 2,] [+] 1 2 3 4 5",
			en: "`Point-free style using pipeline and list operations`\n`Doubles each element in the list and calculates the sum`\n[* 2,] [+] 1 2 3 4 5"
		}
	},
	dict: {
		name: { ja: "辞書 (Dictionary) と要素取得", en: "Dictionary (Get)" },
		code: {
			ja: "`辞書の定義と、シングルクォート(')による要素へのアクセス(Get)です`\nmyDict :\n\t`key1` : `value_one`\n\t`key2` : `value_two`\n\nmyDict ' `key2`",
			en: "`Dictionary definition and accessing elements using the single quote (') Get operator`\nmyDict :\n\t`key1` : `value_one`\n\t`key2` : `value_two`\n\nmyDict ' `key2`"
		}
	},
	match_case: {
		name: { ja: "パターンマッチ (Match Case)", en: "Pattern Matching" },
		code: {
			ja: "`引数xの値に応じて分岐するクロージャ（関数）の定義と実行です`\nmyMatch : x ?\n\t0 : `zero`\n\t1 : `one`\n\t`other`\n\nmyMatch 1",
			en: "`Defining and executing a closure that branches based on the argument x`\nmyMatch : x ?\n\t0 : `zero`\n\t1 : `one`\n\t`other`\n\nmyMatch 1"
		}
	},
	recursion: {
		name: { ja: "再帰関数 (階乗)", en: "Recursion (Factorial)" },
		code: {
			ja: "`Match Caseを内包した再帰関数（階乗計算）の例です`\nfact: n ?\n\tn=0 : 1\n\tn * (fact (n - 1))\n\nfact 5",
			en: "`Recursive function (factorial) containing a Match Case`\nfact: n ?\n\tn=0 : 1\n\tn * (fact (n - 1))\n\nfact 5"
		}
	}
};

// ==========================================
// リファレンスメニューのデータ定義
// ==========================================
export const referenceData = {
	ja: [
		{
			id: "philosophy",
			menuLabel: "🧠 哲学と特徴",
			title: "Signの哲学と特徴",
			content: `
				<h4>予約語とステートメントの廃止</h4>
				<p><code>if</code>や<code>for</code>などの制御用予約語は存在しません。また、文（ステートメント）はなく、すべての計算は必ず値を返します。条件分岐やループも演算子と関数の組み合わせで表現します。</p>
				<h4>真偽値（ブーリアン）の不在</h4>
				<p>明示的な<code>true</code>や<code>false</code>はありません。「空のリスト(<code>_</code>)」および「未評価の項」を<code>false</code>とし、それ以外を<code>true</code>とみなして短絡評価を行います。</p>
				<h4>空白は「余積」演算子</h4>
				<p>空白は単なる文字の区切りではなく、強力な演算子です。文脈によって「リストへの追加」「リストの結合」「関数適用」という重要な役割を担います。</p>
				<h4>すべてはリストである</h4>
				<p>コンマ(<code>,</code>)は「積」としてリストを構築し、空白は「余積」としてそれらを統合します。コードそのものもリストとして解釈されます。</p>
			`
		},
		{
			id: "basics",
			menuLabel: "📝 基礎・ブロック",
			title: "基礎とブロック構築",
			content: `
				<h4>コメントと Unit</h4>
				<ul>
					<li>行頭から始まる <code>\`</code>（バッククォート）で囲まれた文字列は<b>ドキュメントコメント</b>として扱われ、評価値は <code>Unit</code> になります。</li>
					<li>純粋な文字列の式としたい場合は <code>(\`hello\`)</code> のように括弧で囲むか、インデントを入れます。</li>
					<li><code>_</code> (アンダースコア) 一文字も <code>Unit</code> (空のリスト) を表します。</li>
				</ul>
				<h4>インデントによるブロック</h4>
				<ul>
					<li>Signでは<b>タブ文字（Tab）によるインデント</b>を使って階層を表現できます。</li>
					<li>これは括弧 <code>[ ]</code> で囲むのと同じ意味になり、ネストしたリストや関数を美しく記述できます。</li>
				</ul>
			`
		},
		{
			id: "placement",
			menuLabel: "📐 配置ルール",
			title: "演算子の配置ルール",
			content: `
				<h4>前置・中置・後置</h4>
				<p>Signでは演算子の「位置」がそのまま意味を持ちます。空白の有無が厳密に判定されます。</p>
				<ul>
					<li><b>前置演算子</b>：リテラルの<u>前</u>に置きます。演算子とリテラルの間に空白を入れてはいけません。<br>例：<code>!5</code> (否定), <code>~a</code> (連続リスト)</li>
					<li><b>中置演算子</b>：リテラルの<u>間</u>に置きます。演算子の前後に空白が必要です。<br>例：<code>1 + 2</code>, <code>a : b</code></li>
					<li><b>後置演算子</b>：リテラルの<u>後ろ</u>に置きます。演算子とリテラルの間に空白を入れてはいけません。<br>例：<code>5!</code> (階乗), <code>a~</code> (展開)</li>
				</ul>
			`
		},
		{
			id: "operators",
			menuLabel: "⚙️ 基本演算子",
			title: "基本演算子",
			content: `
				<h4>算術演算子</h4>
				<table class="cheat-sheet">
					<tr><th>演算子</th><th>説明</th><th>構文例</th></tr>
					<tr><td><code>+ - * / %</code></td><td>加減乗除・剰余 (中置)</td><td><code>1 + 2</code></td></tr>
					<tr><td><code>^</code></td><td>冪乗 (中置)</td><td><code>2 ^ 3</code></td></tr>
					<tr><td><code>!</code></td><td>階乗 (後置)</td><td><code>5!</code></td></tr>
				</table>
				<h4>比較・論理演算子</h4>
				<table class="cheat-sheet">
					<tr><th>演算子</th><th>説明</th><th>構文例</th></tr>
					<tr><td><code>= != > < >= <=</code></td><td>比較 (中置)</td><td><code>a = b</code></td></tr>
					<tr><td><code>& | ;</code></td><td>And, Or, Xor (中置)</td><td><code>a & b</code></td></tr>
					<tr><td><code>!</code></td><td>否定/Not (前置)</td><td><code>!_</code></td></tr>
				</table>
				<h4>定義 (Define)</h4>
				<table class="cheat-sheet">
					<tr><th>演算子</th><th>説明</th><th>構文例</th></tr>
					<tr><td><code>:</code></td><td>値や関数の定義・代入 (中置)</td><td><code>a : 10</code></td></tr>
				</table>
			`
		},
		{
			id: "lists_funcs",
			menuLabel: "📦 リスト・辞書・関数",
			title: "リスト・辞書・関数",
			content: `
				<h4>リストと辞書の構築</h4>
				<ul>
					<li><code>,</code> (積) : 要素を区切ってリストを作ります。例：<code>1 , 2 , 3</code></li>
					<li><code>[ ]</code> : ブラケットで囲むと平坦なリストになります。</li>
					<li><b>辞書 (Dictionary)</b>: <code>キー : 値</code> の形式とインデントで作成します。値の取得には <code>'</code> (Get中置演算子) を使います。</li>
				</ul>
				<h4>関数（ラムダ）の構築</h4>
				<ul>
					<li><code>?</code> : 左辺を引数、右辺を処理とするクロージャを定義します。<br>例：<code>x y ? x + y</code></li>
					<li><b>Match Case</b>: 条件分岐も同じ構文で行います。<br>例：<code>x = 0 : 1</code> (xが0なら1)</li>
				</ul>
				<h4>ポイントフリースタイル</h4>
				<ul>
					<li><code>[+] 1 2 3</code> : 左畳み込み (Fold)。合計などを計算します。</li>
					<li><code>[* 2,] 1 2 3</code> : 写像 (Map)。クロージャ末尾の <code>,</code> により、各要素の計算結果がリストとして返されます。</li>
				</ul>
			`
		},
		{
			id: "special_ops",
			menuLabel: "✨ 特殊演算子",
			title: "Sign特有の演算子",
			content: `
				<h4>チルダ ( ~ ) の振る舞い</h4>
				<p>位置によってリストに対する働き方が劇的に変わります。</p>
				<ul>
					<li><b>中置 (範囲)</b>: <code>[1 ~ 5]</code> のように範囲リストを作成します。</li>
					<li><b>後置 (展開)</b>: <code>list~</code> のように、リストの要素を展開して渡します。</li>
					<li><b>前置 (連続)</b>: <code>~x</code> のように、残りの引数をすべてリストにまとめます。</li>
				</ul>
				<h4>メモリアクセスと参照 (境界演算子)</h4>
				<p>低レイヤの操作も、関数ではなく記号の連鎖で表現します。</p>
				<ul>
					<li><code>$</code> (前置): アドレスの取得 (Get Location)</li>
					<li><code>@</code> (前置): アドレスに対する参照 (Input)</li>
					<li><code>#</code> (中置): アドレスへの書き込み (Output)</li>
				</ul>
			`
		},
		{
			id: "cheatsheet",
			menuLabel: "💡 チートシート",
			title: "実践チートシート",
			content: `
				<h4>リスト操作</h4>
				<table class="cheat-sheet">
					<tr><th>操作</th><th>構文例</th><th>実行結果 (Output)</th></tr>
					<tr><td>階層リスト (積)</td><td><code>1 , 2 , 3</code></td><td><code>[1, 2, 3]</code></td></tr>
					<tr><td>平坦リスト (和)</td><td><code>[1 2 3]</code></td><td><code>[1, 2, 3]</code></td></tr>
					<tr><td>先頭に追加</td><td><code>0 [1 2]</code></td><td><code>[0, 1, 2]</code></td></tr>
					<tr><td>末尾に追加</td><td><code>[1 2] 3</code></td><td><code>[1, 2, 3]</code></td></tr>
					<tr><td>リストの結合</td><td><code>[1 2] [3 4]</code></td><td><code>[1, 2, 3, 4]</code></td></tr>
					<tr><td>要素の取得(先頭)</td><td><code>[1 2 3] ' 0</code></td><td><code>1</code></td></tr>
					<tr><td>範囲リスト構築</td><td><code>[1 ~ 5]</code></td><td><code>[1, 2, 3, 4, 5]</code></td></tr>
					<tr><td>リストの展開</td><td><code>[0 [1 2]~ 3]</code></td><td><code>[0, 1, 2, 3]</code></td></tr>
				</table>
				<h4>辞書と関数</h4>
				<table class="cheat-sheet">
					<tr><th>操作</th><th>構文例</th><th>実行結果 (Output)</th></tr>
					<tr><td>辞書の値取得</td><td><code>dict ' \`key\`</code></td><td>(対応する値)</td></tr>
					<tr><td>無名関数の実行</td><td><code>[x ? x * 2] 2</code></td><td><code>4</code></td></tr>
					<tr><td>畳み込み (Fold)</td><td><code>[+] 1 2 3</code></td><td><code>6</code></td></tr>
					<tr><td>写像 (Map)</td><td><code>[* 2,] 1 2 3</code></td><td><code>[2, 4, 6]</code></td></tr>
				</table>
			`
		}
	],
	en: [
		{
			id: "philosophy",
			menuLabel: "🧠 Philosophy",
			title: "Philosophy & Features",
			content: `
				<h4>No Reserved Words or Statements</h4>
				<p>There are no control keywords like <code>if</code> or <code>for</code>. There are no statements; every calculation always returns a value. Control flow is expressed purely through combinations of operators and functions.</p>
				<h4>Absence of Booleans</h4>
				<p>There is no explicit <code>true</code> or <code>false</code>. An empty list (<code>_</code>) and unevaluated terms are treated as <code>false</code>, while everything else is <code>true</code>. Logical operations use short-circuit evaluation based on this.</p>
				<h4>Whitespace as "Coproduct"</h4>
				<p>Whitespace is not just a separator; it's a powerful operator. Depending on context, it functions as list append, list concatenation, or function application.</p>
				<h4>Everything is a List</h4>
				<p>Commas (<code>,</code>) create lists as a "Product", and whitespace integrates them as a "Coproduct". The source code itself is also evaluated as a list.</p>
			`
		},
		{
			id: "basics",
			menuLabel: "📝 Basics & Blocks",
			title: "Basics & Block Building",
			content: `
				<h4>Comments and Unit</h4>
				<ul>
					<li>Strings wrapped in <code>\`</code> (backticks) starting at the beginning of a line are <b>document comments</b>, and evaluate to <code>Unit</code>.</li>
					<li>To treat them as string expressions, wrap them in parentheses like <code>(\`hello\`)</code> or indent them.</li>
					<li>A single <code>_</code> (underscore) represents <code>Unit</code> (an empty list).</li>
				</ul>
				<h4>Blocks by Indentation</h4>
				<ul>
					<li>Sign uses <b>Tab indentation</b> to build hierarchy.</li>
					<li>This is semantically identical to wrapping elements in brackets <code>[ ]</code>, allowing for elegant, parenthesis-free nested structures.</li>
				</ul>
			`
		},
		{
			id: "placement",
			menuLabel: "📐 Syntax",
			title: "Operator Placement",
			content: `
				<h4>Prefix, Infix, Postfix</h4>
				<p>In Sign, the "position" of an operator dictates its meaning. Whitespace is strictly evaluated.</p>
				<ul>
					<li><b>Prefix</b>: Placed <u>before</u> the literal. No whitespace allowed between operator and literal.<br>Example: <code>!5</code> (Not), <code>~a</code></li>
					<li><b>Infix</b>: Placed <u>between</u> literals. Whitespace is required before and after.<br>Example: <code>1 + 2</code>, <code>a : b</code></li>
					<li><b>Postfix</b>: Placed <u>after</u> the literal. No whitespace allowed between literal and operator.<br>Example: <code>5!</code> (Factorial), <code>a~</code></li>
				</ul>
			`
		},
		{
			id: "operators",
			menuLabel: "⚙️ Operators",
			title: "Basic Operators",
			content: `
				<h4>Arithmetic Operators</h4>
				<table class="cheat-sheet">
					<tr><th>Operator</th><th>Description</th><th>Example</th></tr>
					<tr><td><code>+ - * / %</code></td><td>Add, Sub, Mul, Div, Mod (Infix)</td><td><code>1 + 2</code></td></tr>
					<tr><td><code>^</code></td><td>Power (Infix)</td><td><code>2 ^ 3</code></td></tr>
					<tr><td><code>!</code></td><td>Factorial (Postfix)</td><td><code>5!</code></td></tr>
				</table>
				<h4>Comparison & Logical</h4>
				<table class="cheat-sheet">
					<tr><th>Operator</th><th>Description</th><th>Example</th></tr>
					<tr><td><code>= != > < >= <=</code></td><td>Comparison (Infix)</td><td><code>a = b</code></td></tr>
					<tr><td><code>& | ;</code></td><td>And, Or, Xor (Infix)</td><td><code>a & b</code></td></tr>
					<tr><td><code>!</code></td><td>Not (Prefix)</td><td><code>!_</code></td></tr>
				</table>
				<h4>Define</h4>
				<table class="cheat-sheet">
					<tr><th>Operator</th><th>Description</th><th>Example</th></tr>
					<tr><td><code>:</code></td><td>Define value or function (Infix)</td><td><code>a : 10</code></td></tr>
				</table>
			`
		},
		{
			id: "lists_funcs",
			menuLabel: "📦 Lists & Funcs",
			title: "Lists, Dicts & Funcs",
			content: `
				<h4>Building Lists and Dicts</h4>
				<ul>
					<li><code>,</code> (Product) : Separates elements to create a list. Example: <code>1 , 2 , 3</code></li>
					<li><code>[ ]</code> : Enclosing in brackets creates a flattened list.</li>
					<li><b>Dictionary</b>: Use <code>key : value</code> format with indentation. Use the <code>'</code> (Get operator) to access values.</li>
				</ul>
				<h4>Building Functions (Lambdas)</h4>
				<ul>
					<li><code>?</code> : Defines a closure (Left side = args, Right side = logic).<br>Example: <code>x y ? x + y</code></li>
					<li><b>Match Case</b>: Conditional branching uses the same syntax.<br>Example: <code>x = 0 : 1</code> (If x is 0, return 1)</li>
				</ul>
				<h4>Point-free Style</h4>
				<ul>
					<li><code>[+] 1 2 3</code> : Left Fold. Calculates the sum.</li>
					<li><code>[* 2,] 1 2 3</code> : Map. The trailing <code>,</code> returns the result of each element as a list.</li>
				</ul>
			`
		},
		{
			id: "special_ops",
			menuLabel: "✨ Special Ops",
			title: "Sign Special Operators",
			content: `
				<h4>Behavior of Tilde ( ~ )</h4>
				<p>The role of tilde changes dramatically based on position.</p>
				<ul>
					<li><b>Infix (Range)</b>: <code>[1 ~ 5]</code> creates a range list.</li>
					<li><b>Postfix (Spread)</b>: <code>list~</code> expands the list elements into the current scope.</li>
					<li><b>Prefix (Rest)</b>: <code>~x</code> gathers remaining arguments into a single list.</li>
				</ul>
				<h4>Memory Access (Boundary Ops)</h4>
				<p>Low-level operations are also expressed through symbol chains.</p>
				<ul>
					<li><code>$</code> (Prefix): Get Location (Address)</li>
					<li><code>@</code> (Prefix): Reference Address (Input)</li>
					<li><code>#</code> (Infix): Write to Address (Output)</li>
				</ul>
			`
		},
		{
			id: "cheatsheet",
			menuLabel: "💡 Cheat Sheet",
			title: "Practical Cheat Sheet",
			content: `
				<h4>List Operations</h4>
				<table class="cheat-sheet">
					<tr><th>Operation</th><th>Syntax</th><th>Output</th></tr>
					<tr><td>Nested List (Product)</td><td><code>1 , 2 , 3</code></td><td><code>[1, 2, 3]</code></td></tr>
					<tr><td>Flat List (Coproduct)</td><td><code>[1 2 3]</code></td><td><code>[1, 2, 3]</code></td></tr>
					<tr><td>Prepend</td><td><code>0 [1 2]</code></td><td><code>[0, 1, 2]</code></td></tr>
					<tr><td>Append</td><td><code>[1 2] 3</code></td><td><code>[1, 2, 3]</code></td></tr>
					<tr><td>Concat</td><td><code>[1 2] [3 4]</code></td><td><code>[1, 2, 3, 4]</code></td></tr>
					<tr><td>Get Head</td><td><code>[1 2 3] ' 0</code></td><td><code>1</code></td></tr>
					<tr><td>Range List</td><td><code>[1 ~ 5]</code></td><td><code>[1, 2, 3, 4, 5]</code></td></tr>
					<tr><td>Spread List</td><td><code>[0 [1 2]~ 3]</code></td><td><code>[0, 1, 2, 3]</code></td></tr>
				</table>
				<h4>Dictionaries & Functions</h4>
				<table class="cheat-sheet">
					<tr><th>Operation</th><th>Syntax</th><th>Output</th></tr>
					<tr><td>Get Dict Value</td><td><code>dict ' \`key\`</code></td><td>(Mapped value)</td></tr>
					<tr><td>Apply Lambda</td><td><code>[x ? x * 2] 2</code></td><td><code>4</code></td></tr>
					<tr><td>Apply (Fold)</td><td><code>[+] 1 2 3</code></td><td><code>6</code></td></tr>
					<tr><td>Map</td><td><code>[* 2,] 1 2 3</code></td><td><code>[2, 4, 6]</code></td></tr>
				</table>
			`
		}
	]
};