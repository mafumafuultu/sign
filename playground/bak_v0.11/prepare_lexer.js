// 入力コードを正規化する

const prepare = code => {
  let normalized = code
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\xA0\xAD]/g, '')

    // ★修正：行頭の`から改行までを削除（EOF対応のために $ を追加）
    // これにより「行頭の\`は問答無用で絶対にコメント」という仕様が完璧に適用されます
    .replace(/^`[^\r\n]*(\r\n|[\r\n]|$)/gm, '')

    .replace(/(\r\n|[\r\n])/g, '\r')
    .replace(/\\\r/g, '\\\n');

  // ----------------------------------------------------
  // ★ ここに追加: 絶対値 |...| を ( | ... | ) に置換する
  normalized = normalized
    .replace(/(?<=^|[\s\(\[\{,;:=])\|(?!\s|\|)/g, '( | ')  // 開始の |
    .replace(/(?<!\s|\|)\|(?=$|[\s\)\}\],;:=])/g, ' | )'); // 終了の |
  // ----------------------------------------------------

  return normalized;
};

const markSeparator = code => code
  // 【既存】括弧類の分割
  .replace(
    /(\\[\s\S])|(`[^`\r\n]*`)|(?<!\\)([\{\(\[])|(?<!\\)([\}\)\]])/g,
    (_, $1, $2, $3, $4) => ($1 || $2) || ($3 && '\x1F[\x1F') || ($4 && '\x1F]\x1F')
  )
  // ★修正：中置確定の2文字演算子と、1文字演算子を「同時」に分割する（※重要）
  // これにより、2文字(e.g. !=)の内部にある1文字(=)が再分割される破壊を防ぎます
  .replace(
    /(\\[\s\S])|(`[^`\r\n]*`)|(<=|==|>=|!=|<<|>>|\|\||;;|&&|~\+|~-|~\*|~\/|~\^)|(?<!\\)([:?,;&<=>+*/%^'])/g,
    (_, esc, str, doubleOp, singleOp) =>
      (esc || str) || `\x1F${doubleOp || singleOp}\x1F`
  )
  // マイナス (-) の引き算のみを狙い撃ちで分割（-10 などの負の数を保護するため）
  .replace(
    /(\\[\s\S])|(`[^`\r\n]*`)|(?<=[\w\)\]\}])(-)(?=[\w\(\[\{])/g,
    (_, esc, str, minusOp) =>
      (esc || str) || `\x1F${minusOp}\x1F`
  )
  // 【既存】空白の処理（余積演算子）
  .replace(
    /(\\[\s\S])|(`[^`\r\n]*`)|(?<!\\) /g,
    (_, $1, $2, $3) => ($1 || $2) || ($3 && `\x1F`)
  )
  // 【既存】改行・タブの処理
  .replace(
    /(\\[\s\S])|(`[^`\r\n]*`)|([\r])|([\t])/g,
    (_, e, s, $1, $2) => (e ? e + '\x1F' : s) || ($1 && `\x1F\n\x1F`) || ($2 && `\x1F\t\x1F`)
  );

const parseToSExpr = (code) => {
  const marked = markSeparator(prepare(code));
  const tokens = marked.split('\x1F').filter(t => t !== '');

  const root = [];
  // indentStack: { list: Array, indent: Number }
  let indentStack = [{ list: root, indent: 0 }];

  const currentList = () => indentStack[indentStack.length - 1].list;

  // Split into lines
  let lines = [];
  let temp = [];
  for (const t of tokens) {
    if (t === '\n') {
      if (temp.length > 0) lines.push(temp);
      temp = [];
    } else {
      temp.push(t);
    }
  }
  if (temp.length > 0) lines.push(temp);

  for (let l of lines) {
    if (l.length === 0) continue;

    // Strict Tab Indentation Check
    let indent = 0;
    for (const t of l) {
      if (t === '\t') indent++;
      else if (t.startsWith(' ')) {
        throw new Error("Invalid indentation: Spaces are not allowed. Use tabs only.");
      }
      else break;
    }

    // Remove leading tabs
    const content = l.slice(indent);
    if (content.length === 0) continue;

    // Check for space indentation in content (e.g. 4 spaces)
    // The tokenizer separates spaces as tokens, so if we see a space token at start of content, it's mixed indentation or space indent.
    if (content[0] === ' ' || (content[0] && content[0].startsWith(' '))) { // content[0] could be empty string from split? No, filtered.
      // Check if it's a space token (our tokenizer puts spaces in \x1F)
      // markSeparator replaces space with \x1F. split removes empty.
      // So space becomes empty string? No.
      // replaced by \x1F. split('\x1F').
      // Wait, markSeparator replaces space with \x1F?
      // .replace(/...|(?<!\\) /g, ... => \x1F)
      // If we have "    ", it becomes \x1F\x1F\x1F\x1F.
      // trace: ` ` -> `\x1F`. split -> ``. filtered -> gone.
      // So spaces are REMOVED?
      // The original code passed spaces as empty tokens?
      // `rawTokens = marked.split('\x1F').filter(t => t !== '')`
      // if space -> \x1F. split -> ["", ""]. filter -> [].
      // So spaces are IGNORED.

      // REQUIRED: We need to detect spaces to throw error.
      // We must check `code` or `marked` before split/filter?
      // Or change markSeparator to keep spaces as distinct tokens?
    }

    // RE-VERIFY: `prepare_lexer` lines 31-33:
    // .replace( ... |(?<!\\) /g, ... ($3 && `\x1F`) )
    // Space is replaced by \x1F.
    // So "  x" -> "\x1F\x1Fx". split -> ["", "", "x"]. filter -> ["x"].
    // Spaces are lost.

    // FIX: We need to enforce this BEFORE tokenizing.
    // Let's rely on `toSExpr` to check original lines? 
    // Or simpler: check strictly in `toSExpr` iteration?
    // But `tokens` don't have spaces.

    // We can check `code` or `lines` before processing?
    // Let's add a pre-check validation for 4-spaces at start of line.
  }

  // Validation Pass
  const linesRaw = prepare(code).split('\r'); // Processed code has \r lines
  for (let i = 0; i < linesRaw.length; i++) {
    const line = linesRaw[i];
    const match = line.match(/^(\s*)/);
    if (match) {
      const indentStr = match[1];
      if (indentStr.length > 0) { // Only check if there's actual indentation
        for (let charIdx = 0; charIdx < indentStr.length; charIdx++) {
          if (indentStr[charIdx] === ' ') {
            // Spaces are no longer allowed for indentation at all.
            throw new Error(`Invalid indentation at line ${i + 1}: Spaces are not allowed. Use tabs only.`);
          }
        }
      }
    }
  }

  // Resume Processing with `lines` and `tokens` (spaces already removed)

  for (let l of lines) {
    if (l.length === 0) continue;

    let indent = 0;
    while (l.length > 0 && l[0] === '\t') {
      indent++;
      l.shift();
    }

    const content = l;
    if (content.length === 0) continue;

    let top = indentStack[indentStack.length - 1];

    if (indent > top.indent) {
      // New Block
      const newBlock = [];
      const parentList = currentList();

      // If parent list is empty? (Should not happen if previous line existed)
      // Check if previous line ended with "open op" like `?` or `:`
      // If so, `newBlock` is the argument.
      // If not, `newBlock` is... what? A new argument? `func arg`
      // `func \n indent arg` -> `func arg`

      // We push the new block to the current list.
      // NOTE: User wants "indent" to be like "[".
      // So we just push a new array.
      parentList.push(newBlock);
      indentStack.push({ list: newBlock, indent: indent });

    } else if (indent < top.indent) {
      // Dedent
      while (indentStack.length > 1 && indentStack[indentStack.length - 1].indent > indent) {
        indentStack.pop();
      }

      // Check if we dedented too much? (mismatched indent)
      // Python allows matches to previous levels.
      if (indentStack[indentStack.length - 1].indent !== indent) {
        // This implies the indentation level doesn't match any outer block
        // For now, we default to the nearest outer block (standard behavior).
      }

      // Seperator handling:
      // If we dedent, we are back in a list.
      // Should we add a separator?
      // `x \n y` -> `x, y` (in list)
      // `block \n y` -> `block, y`
      currentList().push({ type: 'separator', value: '\n' });
    } else {
      // Same indent -> Separate statement
      currentList().push({ type: 'separator', value: '\n' });
    }

    // Process Line Content
    // Handle inline blocks [ ] ( {
    // And map ( { to [ behavior
    const processed = processLine(content);

    currentList().push(...processed);
  }

  return root;
};

const processLine = (tokens) => {
  let res = [];
  let stack = [res];

  for (const t of tokens) {
    if (t === '[' || t === '(' || t === '{') {
      const nu = [];
      stack[stack.length - 1].push(nu);
      stack.push(nu);
    } else if (t === ']' || t === ')' || t === '}') {
      if (stack.length > 1) {
        const currentList = stack[stack.length - 1];

        // ★ Signの哲学：すべての括弧は等価。
        // ブロック内にカンマ ',' が直接存在する場合のみ、リスト(タプルの連鎖)とみなして終端()を付与する
        if (currentList.includes(',')) {
          // 末尾が既にカンマで終わっていない場合のみカンマを追加
          if (currentList[currentList.length - 1] !== ',') {
            currentList.push(',');
          }
          // 空の配列 [] を追加（これはパーサ側で Unit / NaN として解釈されます）
          currentList.push([]);
        }

        stack.pop();
      }
    } else if (t !== '\t') {
      stack[stack.length - 1].push(t);
    }
  }
  return res;
};

export default {
  prepare,
  markSeparator,
  parseToSExpr
}
