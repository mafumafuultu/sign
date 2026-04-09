import { isUnitNode } from './util.js';

export class ASTNormalizer {
  extractFoldOp(funcNode) {
    if (funcNode && funcNode.type === 'infix' && funcNode.op === '?') {
      if (funcNode.right && funcNode.right.type === 'infix' && funcNode.right.op === '?') {
        if (funcNode.right.right && funcNode.right.right.type === 'infix') {
          return funcNode.right.right.op;
        }
      }
    }
    return null;
  }

  extractMapLambda(funcNode) {
    if (funcNode && funcNode.type === 'infix' && funcNode.op === '?') {
      if (!(funcNode.right && funcNode.right.type === 'infix' && funcNode.right.op === '?')) {
        let cleanFunc = JSON.parse(JSON.stringify(funcNode));
        let innerBody = cleanFunc.right;
        if (innerBody && innerBody.type === 'infix') {
          let innerRight = innerBody.right;
          if (innerRight && innerRight.type === 'infix' && innerRight.op === ',') {
            if (isUnitNode(innerRight.right) || (innerRight.right && innerRight.right.value === 'nan')) {
              innerBody.right = innerRight.left;
              return cleanFunc; // ⚡ 修正：Map構文を満たした場合のみ返す
            }
          }
        }
        return null; // ⚡ 修正：カンマで終わっていない普通のラムダは null を返す！
      }
    }
    return null;
  }

  flattenApply(node) {
    let args = [];
    let current = node;
    while (current && (current.type === 'apply' || current.type === 'call')) {
      args.unshift(current.arg || current.args || current.right);
      current = current.func || current.fn || current.callee || current.left;
    }
    return { func: current, args: args };
  }

  // ⚡ 追加: コンスセル連鎖やリスト構造をフラットな配列に戻すヘルパー
  // パイプラインの中間結果を次の関数の引数として渡すために使用します
  extractListElements(node) {
    if (!node) return [];

    // ⚡ Map展開などで生成されたカンマ連鎖を確実にフラットな配列に分解する
    if (node.type === 'infix' && node.op === ',') {
      if (node.right && (node.right.value === 'nan' || node.right.name === 'nan' || isUnitNode(node.right))) {
        return [node.left];
      }
      return [node.left, ...this.extractListElements(node.right)];
    }

    if (['BlockSeq', 'SequenceNode', 'ProductNode', 'CommaNode'].includes(node.type)) {
      if (node.right && (node.right.value === 'nan' || node.right.name === 'nan' || isUnitNode(node.right))) {
        return [node.left];
      }
      return [node.left, ...this.extractListElements(node.right)];
    }
    if (node.value === 'nan' || node.name === 'nan' || isUnitNode(node)) return [];
    return [node];
  }

  // ⚡ 修正: isBindingRight (束縛の右側かどうか) コンテキストを追加
  normalize(ast, isDictContext = false, isBindingRight = false) {
    if (!ast) return ast;
    if (Array.isArray(ast)) return ast.map(node => this.normalize(node, isDictContext, isBindingRight));

    let node = { ...ast };

    // ==========================================
    // ⚡ 中置 ' (get) の正規化: 右辺の識別子を文字列にキャスト
    // ==========================================
    if (node.type === 'infix' && node.op === "'") {
      // ❌ 右辺の強制文字列キャストを廃止！
      // これにより、変数(動的キー)やリスト構造をキーとしてWASMに渡せるようになります。
      return {
        type: 'infix',
        op: "'",
        left: this.normalize(node.left, false),
        right: this.normalize(node.right, false)
      };
    }

    // ==========================================
    // ⚡ 辞書型の平坦化 & isBindingRightの伝播
    // ==========================================
    if (node.type === 'infix' && node.op === ':') {
      let rightNode;

      // ⚡ 修正: group で保護されているブロックも透過して検知する
      let actualRight = node.right;
      let isGroupedBlock = actualRight && actualRight.type === 'group' && actualRight.body && actualRight.body.type === 'block';
      let blockNode = isGroupedBlock ? actualRight.body : (actualRight && actualRight.type === 'block' ? actualRight : null);

      if (blockNode) {
        let body = blockNode.body || [];
        if (body.length === 0) {
          rightNode = { type: 'number', value: 'nan' };
        } else {
          let listNode = { type: 'number', value: 'nan' };
          for (let i = body.length - 1; i >= 0; i--) {
            // ⚡ ブロック内の要素にも isBindingRight = true を伝播させる！
            let elem = this.normalize(body[i], true, true);
            listNode = { type: 'infix', op: ',', left: elem, right: listNode };
          }
          // 保護グループを維持したままリストを返す
          rightNode = isGroupedBlock ? { type: 'group', body: listNode } : listNode;
        }
      } else {
        // ⚡ 右辺の評価のみ isBindingRight = true として伝播
        rightNode = this.normalize(node.right, false, true);
      }

      // 自分が辞書の中にいる場合だけ、: をペア(,)に変換する
      if (isDictContext) {
        let keyNode = node.left;
        if (keyNode && (keyNode.type === 'identifier' || keyNode.type === 'variable')) {
          let keyStr = keyNode.name || keyNode.value || keyNode.text;
          keyNode = { type: 'string', value: '`' + keyStr + '`' };
        }
        return {
          type: 'infix',
          op: ',',
          left: this.normalize(keyNode, false),
          right: rightNode
        };
      } else {
        // トップレベルの代入は : のまま残す！(WASMで local.set される)
        return {
          type: 'infix',
          op: ':',
          left: this.normalize(node.left, false),
          right: rightNode
        };
      }
    }

    // ==========================================
    // Fold / Map の正規化
    // ==========================================
    if (node.type === 'apply' || node.type === 'call') {
      let f = node.func || node.fn || node.callee || node.left;
      let a = node.arg || node.args || node.right;

      // ===== ⚡ここから追加 (デモ版用: 派生演算子対応の3項セット抽出) =====
      const rangeOps = ['~', '~+', '~-', '~*', '~/', '~^'];

      const extractRangeLeft = (n) => {
        if (!n) return { found: false };
        if (n.type === 'postfix' && rangeOps.includes(n.op)) {
          let inner = n.expr || n.left;
          let isSpread = inner && (inner.type === 'block' || inner.type === 'array' || inner.type === 'group' || (inner.type === 'infix' && inner.op === ','));
          if (isSpread) return { found: false };
          return { stripped: inner, found: true, op: n.op };
        }
        if (n.type === 'infix' && n.right) {
          let res = extractRangeLeft(n.right);
          if (res.found) return { stripped: { ...n, right: res.stripped }, found: true, op: res.op };
        }
        if ((n.type === 'apply' || n.type === 'call') && n.arg) {
          let res = extractRangeLeft(n.arg);
          if (res.found) return { stripped: { ...n, arg: res.stripped }, found: true, op: res.op };
        }
        return { found: false };
      };

      let leftRes = extractRangeLeft(f);
      let isRange = false;
      let rangeLeft = null;
      let rangeRight = null;
      let rangeOp = '~';

      if (leftRes.found) {
        isRange = true;
        rangeLeft = leftRes.stripped;
        rangeRight = a;
        rangeOp = leftRes.op;
      } else if (a && a.type === 'prefix' && rangeOps.includes(a.op)) {
        isRange = true;
        rangeLeft = f;
        rangeRight = a.right || a.expr;
        rangeOp = a.op;
      }

      if (isRange) {
        // ⚡ 修正: group もパターンマッチの有効なブロックとして認識させる！
        let isPatternMatch = (rangeRight && (rangeRight.type === 'block' || rangeRight.type === 'group' || (rangeRight.type === 'infix' && rangeRight.op === ':')));
        let isListLiteral = (rangeLeft && (rangeLeft.type === 'block' || rangeLeft.type === 'array' || rangeLeft.type === 'group' || (rangeLeft.type === 'infix' && rangeLeft.op === ',')));

        if (!isPatternMatch && !isListLiteral) {
          let startNode, stepNode;

          if (rangeOp === '~') {
            // 末尾が `~` による切り取りの場合
            if (rangeLeft && rangeLeft.type === 'infix' && rangeOps.includes(rangeLeft.op) && rangeLeft.op !== '~') {
              // 1. `A ~+ B ~ C` の形 (ジェネレータ + 切り取り)
              startNode = rangeLeft.left;
              stepNode = rangeLeft.right;
              rangeOp = rangeLeft.op; // 内側のジェネレータ規則(~+など)を適用
            } else {
              // 2. `A ~ B` の形 (糖衣構文: ステップ1の等差ジェネレータ)
              startNode = rangeLeft;
              stepNode = { type: 'number', value: 1 };
              rangeOp = '~+'; // デフォルトは加算規則
            }
          } else {
            // 3. `A ~+ B` など末尾が `~` でない場合 (無限リスト)
            // デモ版ではメモリ枯渇を防ぐため、仕様通り無限リストとして解釈した上でエラーとする
            throw new Error(`[Demo Limitation] Infinite lists like 'A ${rangeOp} B' are not supported in the WASM demo. Please append '~ MaxValue' to slice it into a finite list.`);
          }

          return {
            type: 'RangeDemo',
            op: rangeOp,
            start: this.normalize(startNode, isDictContext),
            step: this.normalize(stepNode, isDictContext),
            end: this.normalize(rangeRight, isDictContext)
          };
        }
      }
      // ===== ⚡ここまで追加 =====

      // ⚡ [修正] パーサーが [ ] を Unit + Block として出力したものを検知
      let isGroupedA = a && a.type === 'group' && a.body && a.body.type === 'block';
      let actualA = isGroupedA ? a.body : a;
      if (f && (f.type === 'unit' || (f.type === 'identifier' && f.value === 'Unit') || f.value === 'nan') && actualA && actualA.type === 'block') {
        let body = actualA.body || [];
        if (body.length === 0) return { type: 'number', value: 'nan' };

        let listNode = { type: 'number', value: 'nan' };
        for (let i = body.length - 1; i >= 0; i--) {
          let elem = this.normalize(body[i], true);
          listNode = { type: 'infix', op: ',', left: elem, right: listNode };
        }
        return isGroupedA ? { type: 'group', body: listNode } : listNode;
      }

      let flattened = this.flattenApply(node);
      let func = flattened.func;
      let args = flattened.args;

      // 👇=== 追加: funcがプレースホルダーを伴う単項演算子ならラムダ化する (!_, _!) ===
      let isPrefixPh = func && func.type === 'prefix' && func.expr?.value === '_';
      let isPostfixPh = func && func.type === 'postfix' && func.expr?.value === '_';

      if (isPrefixPh || isPostfixPh) {
        let phName = `$ph_${Math.floor(Math.random() * 1000000)}`;
        let lambdaFunc = {
          type: 'infix',
          op: '?',
          left: { type: 'identifier', value: phName }, // ※プロパティを value に修正
          right: {
            type: func.type,
            op: func.op,
            expr: { type: 'identifier', value: phName }
          }
        };
        // 置換したラムダ関数で Apply ノードを再構築
        let applyNode = lambdaFunc;
        for (let arg of args) {
          applyNode = { type: 'apply', func: applyNode, arg: arg };
        }
        return this.normalize(applyNode, isDictContext, isBindingRight);
      }
      // 👆===========================================================================

      // ==========================================
      // ⚡ 修正：演算子の優先順位逆転（汎用ツリー回転）
      // 関数と引数のすべての要素をフラットに並べ、
      // 比較演算子が混ざっていれば、そこで適用チェーンを左右に真っ二つに割る！
      // ==========================================
      let allElements = [func, ...args];
      let cmpOps = ['=', '!=', '<', '>', '<=', '>='];
      let cmpIndex = allElements.findIndex(el => el && el.type === 'infix' && cmpOps.includes(el.op));

      if (cmpIndex !== -1) {
        let cmpNode = allElements[cmpIndex];

        // 演算子の左側にある要素群 + 演算子自身の左辺
        let leftElements = [...allElements.slice(0, cmpIndex), cmpNode.left];
        // 演算子自身の右辺 + 演算子の右側にある要素群
        let rightElements = [cmpNode.right, ...allElements.slice(cmpIndex + 1)];

        // 再帰的に Apply ノードを組み立て直すヘルパー
        const buildApply = (elements) => {
          let res = elements[0];
          for (let i = 1; i < elements.length; i++) {
            res = { type: 'apply', func: res, arg: elements[i] };
          }
          return res;
        };

        // 組み替えた新しい Infix ノードを再度 normalize に投げる
        return this.normalize({
          type: 'infix',
          op: cmpNode.op,
          left: buildApply(leftElements),
          right: buildApply(rightElements)
        }, isDictContext);
      }

      // ==========================================
      // ⚡ 新機能：関数のパイプライン合成とデータの分離 (左から右への適用)
      // ==========================================
      allElements.forEach(el => this.inferType(el));

      let functions = [];
      let dataElements = [];
      let isDataPhase = false;

      for (let el of allElements) {
        if (!isDataPhase && el.inferredType && el.inferredType.type === 'Function') {
          functions.push(el);
        } else {
          isDataPhase = true; // 一度データが現れたら以後はすべてデータとして扱う
          dataElements.push(el);
        }
      }

      // 関数が2つ以上連続している場合、パイプラインとして適用
      if (functions.length >= 2 && dataElements.length > 0) {
        let currentArgs = [...dataElements];
        let finalResult = null;

        for (let i = 0; i < functions.length; i++) {
          let fn = functions[i];

          // 現在の引数群を fn に適用する Apply ノードを構築
          let applyNode = fn;
          for (let arg of currentArgs) {
            applyNode = { type: 'apply', func: applyNode, arg: arg };
          }

          // ASTを展開 (MapやFoldが発動する)
          finalResult = this.normalize(applyNode, isDictContext);

          // 次の関数のために、結果のリストを再びフラットな引数配列に分解する
          if (i < functions.length - 1) {
            let extracted = this.extractListElements(finalResult);
            if (extracted.length > 1) {
              currentArgs = extracted;
            } else {
              currentArgs = [finalResult];
            }
          }
        }

        return finalResult;
      }

      // ==========================================
      // ⚡ 究極の2条件によるプレースホルダー (_) のマクロ展開
      // ==========================================
      let hasPlaceholder = false;
      let lastArgIsPlaceholder = false;

      for (let i = 0; i < args.length; i++) {
        let arg = args[i];
        let isPh = arg && (arg.type === 'unit' || arg.type === 'Unit' || arg.name === '_' || arg.text === '_' || arg.value === '_');
        if (isPh) {
          hasPlaceholder = true;
          if (i === args.length - 1) {
            lastArgIsPlaceholder = true; // 最後尾が _ なら True
          }
        }
      }

      // ⚡ 究極の2条件：「束縛(:)の右側」かつ「最後尾が _ ではない」場合のみ展開
      if (isBindingRight && hasPlaceholder && !lastArgIsPlaceholder) {
        let placeholders = [];
        let newArgs = [];

        for (let i = 0; i < args.length; i++) {
          let arg = args[i];
          let isPh = arg && (arg.type === 'unit' || arg.type === 'Unit' || arg.name === '_' || arg.text === '_' || arg.value === '_');
          if (isPh) {
            let phName = `$ph_${Math.floor(Math.random() * 1000000)}`;
            let phNode = { type: 'identifier', name: phName };
            placeholders.push(phNode);
            newArgs.push(phNode);
          } else {
            newArgs.push(arg); // 元のASTノードを保持
          }
        }

        // プレースホルダーを一時変数に置き換えた関数適用ツリーを再構築
        let buildApply = (fNode, argNodes) => {
          let res = this.normalize(fNode, false, false);
          for (let i = 0; i < argNodes.length; i++) {
            res = { type: 'infix', op: ' ', left: res, right: this.normalize(argNodes[i], false, false) };
          }
          return res;
        };

        let result = buildApply(func, newArgs);

        // 再構築したツリーを、ラムダで右側からラップしていく (カリー化の実現)
        for (let i = placeholders.length - 1; i >= 0; i--) {
          result = {
            type: 'infix',
            op: '?',
            left: placeholders[i],
            right: result
          };
        }
        return result;
      }

      let foldOp = this.extractFoldOp(func);
      if (foldOp && args.length >= 2) {
        let result = this.normalize(args[0], false);
        for (let i = 1; i < args.length; i++) {
          result = { type: 'infix', op: foldOp, left: result, right: this.normalize(args[i], false) };
        }
        return result;
      }

      let mapLambda = this.extractMapLambda(func);
      if (mapLambda && args.length >= 2) {
        let result = { type: 'number', value: 'nan' };
        for (let i = args.length - 1; i >= 0; i--) {
          let applyNode = {
            type: 'infix',
            op: ' ',
            left: this.normalize(mapLambda, false),
            right: this.normalize(args[i], false)
          };
          result = { type: 'infix', op: ',', left: applyNode, right: result };
        }
        return result;
      }

      return {
        type: 'infix',
        op: ' ',
        left: this.normalize(node.func || node.fn || node.callee || node.left, false),
        right: this.normalize(node.arg || node.args || node.right, false)
      };
    }

    // ==========================================
    // その他のノードの正規化
    // ==========================================
    if (node.type === 'block' && node.body) {
      node.body = node.body.map(n => this.normalize(n, false));
      return node;
    }

    if (isUnitNode(node)) {
      return { type: 'number', value: 'nan' };
    }

    if (node.type === 'char' || node.type === 'char_literal' || node.type === 'character') {
      if (typeof node.value === 'string') {
        let val = node.value;
        if (val.startsWith('0u')) {
          return { type: 'char', value: parseInt(val.slice(2), 16) };
        } else if (val.startsWith('\\')) {
          return { type: 'char', value: val.charCodeAt(1) };
        } else {
          return { type: 'char', value: val.charCodeAt(0) };
        }
      }
      return node;
    }

    if (node.type === 'prefix' && node.op === '\\') {
      let charStr = node.right.name || node.right.value || node.right.text || '';
      return { type: 'char', value: String(charStr).charCodeAt(0) };
    }

    if (node.type === 'identifier' || node.type === 'variable') {
      let name = String(node.name || node.value || node.text);

      // ⚡修正：parseFloatによる誤変換を防ぐため、接頭辞のチェックを先に行う
      if (name.startsWith('0u')) {
        return { type: 'char', value: parseInt(name.slice(2), 16) };
      }
      if (name.startsWith('0x') || name.startsWith('0r')) {
        return { type: 'number', value: parseInt(name.slice(2), 16) };
      }
      if (name.startsWith('0b')) {
        return { type: 'number', value: parseInt(name.slice(2), 2) };
      }
      if (name.startsWith('0o')) {
        return { type: 'number', value: parseInt(name.slice(2), 8) };
      }

      // 通常の10進数（浮動小数点含む）のフォールバック
      if (!isNaN(parseFloat(name)) && isFinite(name)) {
        node.type = 'number';
        node.value = parseFloat(name);
        delete node.name;
      }
    }

    if (node.type === 'number' && typeof node.value === 'string') {
      if (node.value.startsWith('0b') || node.value.startsWith('0r')) {
        const base = node.value.startsWith('0b') ? 2 : 16;
        node.value = parseInt(node.value.slice(2), base);
      } else if (node.value.startsWith('0u')) {
        return { type: 'char', value: parseInt(node.value.slice(2), 16) };
      }
    }

    // ==========================================
    // 1. 配列(ブロック)の正規化処理（カンマへの還元と表現の保護）
    // ==========================================
    if (node.type === 'array' || node.type === 'list') {
      let elements = node.elements || node.items || node.value || [];
      if (elements.length === 0) return { type: 'number', value: 'nan' };

      // array は単なるカンマ結合の糖衣構文として扱い、再帰的に infix ',' の処理に委譲する
      let buildComma = (index) => {
        if (index === elements.length - 1) return elements[index];
        return {
          type: 'infix',
          op: ',',
          left: elements[index],
          right: buildComma(index + 1)
        };
      };

      let fakeAst = buildComma(0);
      let normalized = this.normalize(fakeAst, isDictContext, isBindingRight);

      // ⚡ ユーザーの「表現（カッコで囲んだという意図）」を推し量り、
      // ⚡ フラット化の波に飲み込まれないよう group ノードで境界を保護する！
      return {
        type: 'group',
        body: normalized,
        inferredType: normalized.inferredType || { type: 'List' }
      };
    }

    ['left', 'right', 'cond', 'expr', 'argument', 'operand', 'base', 'body', 'content', 'value'].forEach(key => {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          node[key] = node[key].map(n => this.normalize(n, false));
        } else {
          node[key] = this.normalize(node[key], false);
        }
      }
    });

    // ==========================================
    // 静的ディスパッチ処理
    // ==========================================
    this.inferType(node);

    // ⚡ ブロック由来の ProductNode の副作用チェック
    if (node.type === 'ProductNode') {
      const leftType = node.left?.inferredType || { type: 'Unknown' };
      if (leftType.type === 'SideEffect' || node.left?.op === '#') {
        node.type = 'SequenceNode';
        node.inferredType = node.right?.inferredType || { type: 'Unknown' };
        // 末尾の不要なnanを剥がす
        if (node.right && node.right.type === 'ProductNode' && node.right.right &&
          (node.right.right.value === 'nan' || node.right.right.name === 'nan')) {
          node.right = node.right.left;
        }
      } else {
        node.inferredType = { type: 'List' };
      }
    }

    // ⚡ 空白とリテラルカンマのディスパッチ
    if (node.type === 'infix') {
      const leftType = node.left?.inferredType || { type: 'Unknown' };
      const rightType = node.right?.inferredType || { type: 'Unknown' };

      // ===== ⚡ここから追加 (デモ版用: 直接の infix ~ 補正) =====
      const rangeOps = ['~', '~+', '~-', '~*', '~/', '~^'];
      if (rangeOps.includes(node.op)) {
        let startNode, stepNode;
        let finalOp = node.op;

        if (node.op === '~') {
          // 末尾が `~` による切り取りの場合
          if (node.left && node.left.type === 'infix' && rangeOps.includes(node.left.op) && node.left.op !== '~') {
            // `A ~+ B ~ C` の形
            startNode = node.left.left;
            stepNode = node.left.right;
            finalOp = node.left.op;
          } else {
            // `A ~ B` の形 (糖衣構文)
            startNode = node.left;
            stepNode = { type: 'number', value: 1 };
            finalOp = '~+';
          }
        } else {
          // `A ~+ B` などの無限リストはデモ版制約で弾く
          throw new Error(`[Demo Limitation] Infinite lists like 'A ${node.op} B' are not supported in the WASM demo. Please append '~ MaxValue' to slice it into a finite list.`);
        }

        return {
          type: 'RangeDemo',
          op: finalOp,
          start: this.normalize(startNode, isDictContext),
          step: this.normalize(stepNode, isDictContext),
          end: this.normalize(node.right, isDictContext)
        };
      }
      // ===== ⚡ここまで追加 =====

      if (node.op === ' ') {
        if (leftType.type === 'SideEffect' || node.left?.op === '#') {
          node.type = 'SequenceNode';
          node.inferredType = rightType;
        } else if (leftType.type === 'Function') {
          if (rightType.type === 'Function') {
            node.type = 'ComposeNode';
            node.inferredType = { type: 'Function' };
          } else {
            node.type = 'ApplyNode';
            node.inferredType = { type: 'Unknown' };
          }
        } else {
          node.type = 'ProductNode';
          node.inferredType = { type: 'List' };
        }
      }
      else if (node.op === ',') {
        if (leftType.type === 'SideEffect' || node.left?.op === '#') {
          node.type = 'SequenceNode';
          node.inferredType = rightType;
        } else {
          // ⚡ リテラルのカンマは両方持ち上げ専用の 'CommaNode' にする！
          node.type = 'CommaNode';
          node.inferredType = { type: 'List' };
        }
      }
    }
    return node;
  }

  // ⚡ 追加: 簡易的な型推論ヘルパー
  inferType(node) {
    if (node.inferredType) return;

    switch (node.type) {
      case 'number': node.inferredType = { type: 'Float' }; break;
      case 'string': node.inferredType = { type: 'String' }; break;
      case 'char': node.inferredType = { type: 'Char' }; break;
      case 'infix':
        if (node.op === '?') node.inferredType = { type: 'Function' };
        else if (node.op === '#') node.inferredType = { type: 'SideEffect' }; // Prism更新は副作用！
        else if (node.op === ':') node.inferredType = { type: 'Pair' };
        else if (['+', '-', '*', '/'].includes(node.op)) node.inferredType = { type: 'Float' };
        break;
      case 'prefix':
        if (node.op === '$') node.inferredType = { type: 'Pointer' };
        else if (node.op === '~') node.inferredType = { type: 'List' };
        break;
      case 'ProductNode': node.inferredType = { type: 'List' }; break;
      case 'ApplyNode': node.inferredType = { type: 'Unknown' }; break;
      case 'SequenceNode': node.inferredType = node.right?.inferredType || { type: 'Unknown' }; break;
    }
    // 推論できない場合は Unknown を設定
    if (!node.inferredType) node.inferredType = { type: 'Unknown' };
  }
}