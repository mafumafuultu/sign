export class AArch64Generator {
  constructor(locals) {
    this.locals = locals;
    this.code = [];
    this.functions = []; // 関数ブロック用のアセンブリ出力
    this.lambdaCount = 0;
    this.floatConstCount = 0;
    this.floatConsts = []; // e.g. { label: 'fc0', value: 1.5 }
    this.stringConstCount = 0; // ✨ Phase 8
    this.stringConsts = new Map(); // ✨ Phase 8
    this.vsp = 0; // Virtual stack pointer for d-registers
  }

  emit(line) {
    this.code.push(line);
  }

  generate(ast, config = {}) {
    this.code = [];
    this.floatConstCount = 0;
    this.floatConsts = [];
    this.stringConstCount = 0;
    this.stringConsts = new Map();
    this.vsp = 0;
    
    // 変数コレクションの初期化
    this.scopeOffsets = {};
    this.currentScopeSize = 0;
    this.collectVariables(ast);
    
    // ✨ Phase 14: Static Memory Pre-calculation
    this.baseHeapSize = 16;
    this.baseClosureSize = 16;
    this.analyzeMemory(ast);
    const recurBudget = config.recursionBuffer || 1024;
    this.totalHeapSpace = this.baseHeapSize + (recurBudget * 64);
    this.totalClosureSpace = this.baseClosureSize + (recurBudget * 32);
    
    // 16バイトアライメント
    const stackSize = (this.currentScopeSize + 15) & ~15;

    // Emit text section to a temporary array because we need to place data sections afterwards
    const textSection = [];
    const origEmit = this.emit.bind(this);
    this.emit = (line) => textSection.push(line);

    // プロローグ
    this.emit('    stp x29, x30, [sp, #-16]!');
    this.emit('    mov x29, sp');
    if (stackSize > 0) {
        this.emit(`    sub sp, sp, #${stackSize}  // Allocate local variables`);
    }
    
    // ASTルートをトラバース
    this.functions = [];
    this.lambdaCount = 0;
    this.applyCount = 0;
    
    // ヒープポインタの初期設定
    this.emit(`    adrp x0, heap_space`);
    this.emit(`    add x0, x0, :lo12:heap_space`);
    this.emit(`    adrp x1, heap_ptr`);
    this.emit(`    str x0, [x1, :lo12:heap_ptr]`);

    // クロージャヒープポインタの初期設定
    this.emit(`    adrp x0, closure_space`);
    this.emit(`    add x0, x0, :lo12:closure_space`);
    this.emit(`    adrp x1, closure_ptr`);
    this.emit(`    str x0, [x1, :lo12:closure_ptr]`);
    this.emit('');

    // ASTルートをトラバース
    this.visit(ast);

    // 値は d0 レジスタに載っているはずなので、printf で出力する
    if (this.vsp > 0) {
        this.emit('\n    // 評価結果を printf で出力 (トップの値をd0へ移動)');
        if (this.vsp - 1 !== 0) {
            this.emit(`    fmov d0, d${this.vsp - 1}`);
        }
        this.emit(`    fmov x1, d0  // Rawビット列を判定用汎用レジスタへ移動`);
        
        // ✨ Phase 15: Polymorphic Print based on String Space Bounds
        this.emit(`    adrp x2, string_space_start`);
        this.emit(`    add x2, x2, :lo12:string_space_start`);
        this.emit(`    adrp x3, string_space_end`);
        this.emit(`    add x3, x3, :lo12:string_space_end`);
        
        this.emit(`    cmp x1, x2`);
        this.emit(`    b.lt print_as_float`);
        this.emit(`    cmp x1, x3`);
        this.emit(`    b.ge print_as_float`);
        
        // String Route
        this.emit(`    adrp x0, fmt_string`);
        this.emit(`    add x0, x0, :lo12:fmt_string`);
        this.emit(`    bl printf`);
        this.emit(`    b end_print`);
        
        // Float Route
        this.emit(`print_as_float:`);
        this.emit(`    // print_float expects parameter in d0 for %f, but we also pass raw hex in x1`);
        this.emit(`    adrp x0, fmt_float`);
        this.emit(`    add x0, x0, :lo12:fmt_float`);
        this.emit(`    bl printf`);
        this.emit(`end_print:`);
    }

    // エピローグ (終了コード0)
    this.emit('\n    mov w0, 0');
    if (stackSize > 0) {
        this.emit(`    add sp, sp, #${stackSize}  // Free local variables`);
    }
    this.emit('    ldp x29, x30, [sp], #16');
    this.emit('    ret\n');

    // 生成した関数ブロックたちを main() の後ろに展開
    textSection.push(...this.functions);

    // ======================================
    // 組み込み関数郡 (アロケータ等)
    // ======================================
    this.emit('// --- Runtime Allocator ---');
    this.emit('// x0: size to allocate');
    this.emit('// returns: x0 (allocated pointer)');
    this.emit('_alloc:');
    this.emit('    adrp x1, heap_ptr');
    this.emit('    add x1, x1, :lo12:heap_ptr');
    this.emit('    ldr x2, [x1]         // current heap_ptr');
    this.emit('    mov x3, x2           // save for return');
    this.emit('    add x2, x2, x0       // advance pointer');
    this.emit('');
    this.emit('    // ✨ Phase 14: Bounds check');
    this.emit('    adrp x4, heap_space');
    this.emit('    add x4, x4, :lo12:heap_space');
    this.emit(`    ldr x5, =${this.totalHeapSpace}`);
    this.emit('    add x4, x4, x5       // max limit');
    this.emit('    cmp x2, x4');
    this.emit('    b.gt _alloc_panic');
    this.emit('');
    this.emit('    str x2, [x1]         // store new heap_ptr');
    this.emit('    mov x0, x3           // return original pointer');
    this.emit('    ret\n');

    this.emit('// --- Closure Allocator ---');
    this.emit('_alloc_closure:');
    this.emit('    adrp x1, closure_ptr');
    this.emit('    add x1, x1, :lo12:closure_ptr');
    this.emit('    ldr x2, [x1]         // current closure_ptr');
    this.emit('    mov x3, x2           // save for return');
    this.emit('    add x2, x2, x0       // advance pointer');
    this.emit('');
    this.emit('    // ✨ Phase 14: Bounds check');
    this.emit('    adrp x4, closure_space');
    this.emit('    add x4, x4, :lo12:closure_space');
    this.emit(`    ldr x5, =${this.totalClosureSpace}`);
    this.emit('    add x4, x4, x5       // max limit');
    this.emit('    cmp x2, x4');
    this.emit('    b.gt _alloc_panic');
    this.emit('');
    this.emit('    str x2, [x1]         // store new closure_ptr');
    this.emit('    mov x0, x3           // return original pointer');
    this.emit('    ret\n');
    
    this.emit('_alloc_panic:');
    this.emit('    adrp x0, panic_msg');
    this.emit('    add x0, x0, :lo12:panic_msg');
    this.emit('    bl printf');
    this.emit('    mov x0, #1');        // exit_code = 1
    this.emit('    bl exit');           // use glibc exit()
    this.emit('');

    this.emit('// --- runtime deep equality check ---');
    this.emit('// args: d0, d1');
    this.emit('// returns: d0 (1.0 if true, NaN if false)');
    this.emit('_val_eq:');
    this.emit('    // Shallow compare');
    this.emit('    fcmp d0, d1');
    this.emit('    b.vs val_eq_check_nan // Unordered (one or both NaN)');
    this.emit('    b.eq val_eq_true');
    this.emit('');
    this.emit('val_eq_check_pointers:');
    this.emit('    // Check if d0 is pointer');
    this.emit('    fmov x0, d0');
    this.emit('    adrp x2, heap_space');
    this.emit('    add x2, x2, :lo12:heap_space');
    this.emit('    cmp x0, x2');
    this.emit('    b.lt val_eq_false       // d0 < heap_space');
    this.emit(`    ldr x4, =${this.totalHeapSpace}`);
    this.emit('    add x3, x2, x4          // x3 = heap_space max');
    this.emit('    cmp x0, x3');
    this.emit('    b.ge val_eq_false       // d0 >= heap_space max');
    this.emit('');
    this.emit('    // Check if d1 is pointer');
    this.emit('    fmov x1, d1');
    this.emit('    cmp x1, x2');
    this.emit('    b.lt val_eq_false       // d1 < heap_space');
    this.emit('    cmp x1, x3');
    this.emit('    b.ge val_eq_false       // d1 >= heap_space max');
    this.emit('');
    this.emit('    // Both are heap pointers. Recurse.');
    this.emit('    stp x29, x30, [sp, #-32]!');
    this.emit('    str d0, [sp, #16]');
    this.emit('    str d1, [sp, #24]');
    this.emit('    ');
    this.emit('    ldr d0, [x0] // headA');
    this.emit('    ldr d1, [x1] // headB');
    this.emit('    bl _val_eq');
    this.emit('    ');
    this.emit('    // Check head equality');
    this.emit('    fcmp d0, d0');
    this.emit('    b.vs val_eq_restore_false');
    this.emit('    ');
    this.emit('    // Head matches, check tail');
    this.emit('    ldr d0, [sp, #16]');
    this.emit('    ldr d1, [sp, #24]');
    this.emit('    fmov x0, d0');
    this.emit('    fmov x1, d1');
    this.emit('    ldr d0, [x0, #8] // tailA');
    this.emit('    ldr d1, [x1, #8] // tailB');
    this.emit('    bl _val_eq');
    this.emit('    ');
    this.emit('    // Return tail\'s result');
    this.emit('    ldp x29, x30, [sp], #32');
    this.emit('    ret');
    this.emit('');
    this.emit('val_eq_restore_false:');
    this.emit('    ldp x29, x30, [sp], #32');
    this.emit('val_eq_false:');
    this.emit('    adrp x0, fc_nan');
    this.emit('    add x0, x0, :lo12:fc_nan');
    this.emit('    ldr d0, [x0]');
    this.emit('    ret');
    this.emit('');
    this.emit('val_eq_check_nan:');
    this.emit('    // Both must be NaN to be equal');
    this.emit('    fcmp d0, d0');
    this.emit('    b.vc val_eq_false');
    this.emit('    fcmp d1, d1');
    this.emit('    b.vc val_eq_false');
    this.emit('val_eq_true:');
    this.emit('    fmov d0, 1.0');
    this.emit('    ret\n');

    // Restore original emitter
    this.emit = origEmit;
    
    // 全体のアセンブリを出力
    this.emit('// --- AArch64 Assembly (Linux ABI) ---');
    this.emit('.arch armv8-a');
    this.emit('.text');
    this.emit('.align 2');
    this.emit('.globl main');
    this.emit('main:\n');
    
    textSection.forEach(l => this.emit(l));

    // データセクション (定数やフォーマット文字列)
    this.emit('.data');
    this.emit('.align 3');
    this.emit('fmt_float: .asciz "Float: %f | Raw(Hex): 0x%016llx\\n"');
    this.emit('fmt_string: .asciz "String: %s\\n"');
    this.emit('panic_msg: .asciz "Panic: Out of Memory! Static boundary exceeded.\\n"');
    this.emit('fc_nan: .double nan');
    this.emit('fc_inf: .double inf');
    
    this.floatConsts.forEach(fc => {
        this.emit(`${fc.label}: .double ${fc.value}`);
    });
    
    // ✨ Phase 15: Emit string constants with spatial bounds
    this.emit('.align 3');
    this.emit('string_space_start:');
    this.stringConsts.forEach((label, strVal) => {
        this.emit(`${label}: .asciz "${strVal}"`);
    });
    this.emit('.align 3');
    this.emit('string_space_end:');

    // 改行警告を防ぐため、最後に空行を入れる
    this.emit('');

    // BSSセクション: リストなどの動的ヒープ領域用
    this.emit('.bss');
    this.emit('.align 3');
    this.emit('heap_ptr: .skip 8');    // 現在のヒープの先頭アドレスを保持
    this.emit(`heap_space: .skip ${this.totalHeapSpace}`); // ✨ 事前計算サイズ
    this.emit('closure_ptr: .skip 8'); // 現在のクロージャヒープの先頭アドレス
    this.emit(`closure_space: .skip ${this.totalClosureSpace}`); // ✨ 事前計算サイズ
    this.emit('');

    return this.code.join("\n");
  }

  analyzeMemory(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(n => this.analyzeMemory(n));
      return;
    }

    switch (node.type) {
      case 'CommaNode':
      case 'SequenceNode':
        this.baseHeapSize += 16;
        break;
      case 'group': {
        let body = node.body;
        if (body && body.type === 'infix' && body.op === ',') {
           const flattenCommas = (n) => {
              if (!n) return [];
              if (n.type === 'infix' && n.op === ',') {
                 if (n.right && (n.right.value === 'nan' || n.right.name === 'nan')) return [...flattenCommas(n.left)];
                 return [...flattenCommas(n.left), ...flattenCommas(n.right)];
              }
              return [n];
           };
           let elems = flattenCommas(body);
           let kvPairs = [];
           for(let i=0; i<elems.length - 1; i+=2) {
              if (elems[i] && elems[i].type === 'string') {
                  kvPairs.push({ key: elems[i].value, value: elems[i+1] });
              }
           }
           if (kvPairs.length > 0) {
               this.baseHeapSize += kvPairs.length * 8;
           }
        }
        break;
      }
      case 'infix': {
        if (node.op === ' ') {
          this.baseHeapSize += 16; // Worst case fallback to Cons
        }
        if (node.op === '?') {
          let paramName = node.left && node.left.type === 'identifier' ? node.left.value : "$tmp_arg";
          let actualBody = node.right;
          this.baseClosureSize += 16;
          let freeVars = this.getFreeVariables(actualBody, [paramName]);
          this.baseClosureSize += freeVars.length * 8;
        }
        break;
      }
    }
    
    ['left', 'right', 'func', 'arg', 'body', 'expr'].forEach(k => {
       if (node[k]) this.analyzeMemory(node[k]);
    });
  }
  getFreeVariables(node, initialBoundArray) {
    let freeVars = new Set();
    const traverse = (n, bound) => {
      if (!n) return;
      if (n.type === 'identifier') {
        const vName = n.value;
        if (!bound.has(vName) && vName !== '_') freeVars.add(vName);
      } else if (n.type === 'infix') {
        if (n.op === '?') {
          const newBound = new Set(bound);
          let pName = n.left.value;
          if (pName) newBound.add(pName);
          traverse(n.right, newBound);
        } else {
          traverse(n.left, bound);
          traverse(n.right, bound);
        }
      } else if (n.type === 'block' || n.type === 'ModuleBlock') {
        (n.body || []).forEach(stmt => traverse(stmt, bound));
      } else {
        ['left', 'right', 'expr', 'body', 'func', 'arg'].forEach(key => {
          if (n[key]) traverse(n[key], bound);
        });
      }
    };
    traverse(node, new Set(initialBoundArray));
    return Array.from(freeVars);
  }

  collectVariables(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(n => this.collectVariables(n));
      return;
    }
    if (node.type === 'infix' && node.op === ':') {
      if (node.left && node.left.type === 'identifier') {
        const varName = node.left.value;
        if (this.scopeOffsets[varName] === undefined) {
           this.scopeOffsets[varName] = this.currentScopeSize;
           this.currentScopeSize += 8; // 全体Float等8バイト統一
        }

        // ⚡ [Phase 7] もし右辺が辞書型（group等）であった場合、型のレイアウトを追跡する
        let actualRight = node.right;
        
        // リンカがモジュールをブロックとして置換している場合、最後の返り値ノードを調査する
        if (actualRight && (actualRight.type === 'block' || actualRight.type === 'ModuleBlock') && Array.isArray(actualRight.body)) {
             actualRight = actualRight.body[actualRight.body.length - 1]; // This is the group!
        }
        
        if (actualRight && actualRight.type === 'group' && actualRight.body && actualRight.body.op === ',') {
           const flattenCommas = (n) => {
              if (!n) return [];
              if ((n.type === 'infix' || n.type === 'CommaNode') && n.op === ',') {
                 if (n.right && (n.right.value === 'nan' || n.right.name === 'nan')) return [...flattenCommas(n.left)];
                 return [...flattenCommas(n.left), ...flattenCommas(n.right)];
              }
              return [n];
           };
           
           let elems = flattenCommas(actualRight.body);
           let offsetCounter = 0;
           let fields = {};
           for(let i=0; i < elems.length - 1; i+=2) {
              const keyNode = elems[i];
              if(keyNode && keyNode.type === 'string') {
                 let keyName = keyNode.value.replace(/^[`'"]|[`'"]$/g, '');
                 if (fields[keyName] === undefined) {
                    fields[keyName] = offsetCounter;
                    offsetCounter += 8;
                 }
              }
           }
           
           if (!this.recordTypes) this.recordTypes = {};
           this.recordTypes[varName] = { fields: fields, size: offsetCounter };
        }
      }
    }
    if (node.left) this.collectVariables(node.left);
    if (node.right) this.collectVariables(node.right);
    if (node.expr) this.collectVariables(node.expr);
    if (node.func) this.collectVariables(node.func);
    if (node.arg) this.collectVariables(node.arg);
    if (node.body) this.collectVariables(node.body);
  }

  visit(node, isTail = false) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => {
        const startVsp = this.vsp;
        this.visit(n, i === node.length - 1 ? isTail : false);
        // If it's not the last statement in the block/array, drop the result to avoid stack leaks
        if (i < node.length - 1 && this.vsp > startVsp) {
           this.vsp = startVsp; // reset vsp back to drop expression results
        }
      });
      return;
    }

    const nodeVal = node.value || node.name || node.op || '';
    this.emit(`    // [Node] ${node.type} ${nodeVal ? '(' + nodeVal + ')' : ''}`);

    switch (node.type) {
      case 'block':
      case 'ModuleBlock':
        this.visit(node.body, isTail);
        break;
      case 'group': {
          let body = node.body;
          if (body && (body.type === 'infix' || body.type === 'CommaNode') && body.op === ',') {
             const flattenCommas = (n) => {
                if (!n) return [];
                if ((n.type === 'infix' || n.type === 'CommaNode') && n.op === ',') {
                   if (n.right && (n.right.value === 'nan' || n.right.name === 'nan')) return [...flattenCommas(n.left)];
                   return [...flattenCommas(n.left), ...flattenCommas(n.right)];
                }
                return [n];
             };
             let elems = flattenCommas(body);
             let kvPairs = [];
             for(let i=0; i<elems.length - 1; i+=2) {
                if (elems[i] && elems[i].type === 'string') {
                    kvPairs.push({ key: elems[i].value.replace(/^[`'"]|[`'"]$/g, ''), value: elems[i+1] });
                }
             }

             if (kvPairs.length > 0) {
                 this.emit(`    // === Static Dict Allocation ===`);
                 const structSize = kvPairs.length * 8;
                 this.emit(`    mov x0, #${structSize}`);
                 this.emit(`    stp x29, x30, [sp, #-16]!`);
                 this.emit(`    bl _alloc`);
                 this.emit(`    ldp x29, x30, [sp], #16`);
                 this.emit(`    mov x9, x0 // x9 holds struct ptr`);
                 
                 // Evaluate each value and store
                 kvPairs.forEach((kv, idx) => {
                     this.visit(kv.value);
                     const valReg = this.vsp - 1;
                     this.emit(`    str d${valReg}, [x9, #${idx * 8}] // store field '${kv.key}'`);
                     this.vsp--; // pop evaluated value
                 });
                 
                 this.emit(`    fmov d${this.vsp++}, x9 // push struct ptr`);
                 break;
             }
          }
          this.visit(body, isTail);
          break;
      }
      case 'number':
        const label = `fc${this.floatConstCount++}`;
        this.floatConsts.push({ label, value: node.value });
        this.emit(`    adrp x0, ${label}`);
        this.emit(`    add x0, x0, :lo12:${label}`);
        this.emit(`    ldr d${this.vsp++}, [x0]`);
        break;
      case 'string': { // ✨ Phase 8
        let rawStr = node.value.replace(/^[`'"]|[`'"]$/g, '');
        let label = this.stringConsts.get(rawStr);
        if (!label) {
            label = `str_${this.stringConstCount++}`;
            this.stringConsts.set(rawStr, label);
        }
        
        // Push pointer to the string
        this.emit(`    adrp x0, ${label}`);
        this.emit(`    add x0, x0, :lo12:${label}`);
        this.emit(`    fmov d${this.vsp++}, x0 // Load string ptr`);
        break;
      }
      case 'identifier':
        if (node.value === '_' || node.value === 'nan') {
          // Unit(無) 表現および nan は NaN をスタックへ送る
          this.emit(`    adrp x0, fc_nan`);
          this.emit(`    add x0, x0, :lo12:fc_nan`);
          this.emit(`    ldr d${this.vsp++}, [x0]  // load Unit (NaN)`);
        } else if (this.scopeOffsets[node.value] !== undefined) {
          const offset = this.scopeOffsets[node.value];
          this.emit(`    ldr d${this.vsp++}, [sp, #${offset}]  // load local: ${node.value}`);
        } else {
          this.emit(`    // Warning: Undefined identifier ${node.value}`);
          this.emit(`    fmov d${this.vsp++}, xzr // load 0 for undefined`);
        }
        break;
      case 'prefix':
        const expr = node.expr || node.right;
        if (node.op === '$') {
          // アドレス取得: 変数のスタック位置をポインタとして返す
          if (expr && expr.type === 'identifier') {
            const varName = expr.value;
            const offset = this.scopeOffsets[varName];
            if (offset !== undefined) {
              this.emit(`    add x0, sp, #${offset}  // get address of ${varName}`);
              this.emit(`    fmov d${this.vsp++}, x0  // push pointer to FPU stack`);
            } else {
              this.emit(`    // Warning: Undefined identifier for $`);
              this.emit(`    fmov d${this.vsp++}, xzr`);
            }
          } else {
            this.emit(`    // Warning: Invalid target for $`);
             this.emit(`    fmov d${this.vsp++}, xzr`);
          }
        } else if (node.op === '@') {
          // input (デリファレンス): ポインタからデータを読み出す
          this.visit(expr);
          const topReg = this.vsp - 1;
          this.emit(`    fmov x0, d${topReg}  // read pointer address`);
          this.emit(`    ldr d${topReg}, [x0]  // load data from address`);
        } else if (node.op === '!') {
          // 論理否定: NaN なら Infinity、それ以外は NaN を返す (Sign言語の真偽モデル)
          this.visit(expr);
          const topReg = this.vsp - 1;
          this.emit(`    adrp x0, fc_nan`);
          this.emit(`    add x0, x0, :lo12:fc_nan`);
          this.emit(`    ldr d30, [x0]  // d30 = NaN`);
          this.emit(`    adrp x0, fc_inf`);
          this.emit(`    add x0, x0, :lo12:fc_inf`);
          this.emit(`    ldr d31, [x0]  // d31 = Infinity`);
          // 自分自身と比較（NaNの場合のみ unordered: VS フラグが立つ）
          this.emit(`    fcmp d${topReg}, d${topReg}`);
          // NaN なら Infinity (True), 非NaN(True) なら NaN (False)
          this.emit(`    fcsel d${topReg}, d31, d30, vs`);
        } else if (node.op === '!!') {
          // ビット反転
          this.visit(expr);
          const topReg = this.vsp - 1;
          this.emit(`    fcvtzs x9, d${topReg}`);
          this.emit(`    mvn x9, x9`);
          this.emit(`    scvtf d${topReg}, x9`);
        } else if (node.op === '~') {
           // 前置~ (リストキャプチャ) スタブ
           this.visit(expr);
        } else {
          this.visit(expr);
        }
        break;
      case 'postfix':
        const pExpr = node.expr || node.left;
        if (node.op === '!') {
           // 階乗(factorial) スタブ
           this.visit(pExpr);
           this.emit(`    // [Stub] Factorial not fully native yet`);
        } else if (node.op === '~') {
           // 後置~ (Flatten/評価強制) スタブ
           this.visit(pExpr);
        } else {
           this.visit(pExpr);
        }
        break;
      case 'CommaNode':
      case 'SequenceNode':
        this.visit(node.left);
        this.visit(node.right);
        
        if (this.vsp >= 2) {
          const rightReg = this.vsp - 1;
          const leftReg = this.vsp - 2;
          
          // Cons(リスト結合): 16バイトアロケートして、[x0]=left, [x0+8]=right。結果を左レジスタへポインタとして戻す
          this.emit(`    mov x0, #16`);
          this.emit(`    stp x29, x30, [sp, #-16]!`);
          this.emit(`    bl _alloc`);
          this.emit(`    ldp x29, x30, [sp], #16`);
          this.emit(`    str d${leftReg}, [x0]`);
          this.emit(`    str d${rightReg}, [x0, #8]`);
          this.emit(`    fmov d${leftReg}, x0  // ポインタをFPUレジスタへ格納`);
          this.vsp--; // 右辺をポップ
        }
        break;

      case 'infix':
        if (node.op === ':') {
           // Case: Dictionary property mutation (obj ' "key" : value)
           if (node.left && node.left.type === 'infix' && node.left.op === "'") {
               const propNode = node.left;
               if (propNode.left && propNode.left.type === 'identifier' && propNode.right && (propNode.right.type === 'string' || propNode.right.type === 'identifier')) {
                  const objName = propNode.left.value;
                  const keyName = propNode.right.value.replace(/^[`'"]|[`'"]$/g, '');
                  if (this.recordTypes && this.recordTypes[objName] && this.recordTypes[objName].fields[keyName] !== undefined) {
                     const fieldOffset = this.recordTypes[objName].fields[keyName];
                     this.visit(propNode.left);
                     const objReg = this.vsp - 1; // object pointer
                     this.visit(node.right);
                     const rightReg = this.vsp - 1; // RHS value
                     
                     this.emit(`    fmov x0, d${objReg} // Obj pointer`);
                     this.emit(`    str d${rightReg}, [x0, #${fieldOffset}] // mutate field '${keyName}'`);
                     
                     this.vsp--; // pop RHS
                     // Left side was pushed, we overwrite it with RHS value to act as return value
                     this.emit(`    fmov d${this.vsp - 1}, d${rightReg} // return mutated value`);
                     break;
                  }
               }
           }

          // 変数代入: 右辺を評価して左辺(識別子)に格納(現状すべて8byte前提)
          if (node.left && node.left.type === 'identifier') {
             if (node.right && node.right.op === '?') {
                 // 自己再帰のために、名前を伝播する
                 node.right.assignedName = node.left.value;
             }
          }
          this.visit(node.right);

          if (node.left && node.left.type === 'identifier') {
            const varName = node.left.value;
            const offset = this.scopeOffsets[varName];
            
            // 値はポップせずトップに残す (a:b:1 -> a:1 などの連鎖のため)
            this.emit(`    str d${this.vsp - 1}, [sp, #${offset}]  // store local: ${varName}`);
          }
          break;
        }
        
        if (node.op === "'") {
           // Property Access
           if (node.left.type === 'identifier' && (node.right.type === 'identifier' || node.right.type === 'string')) {
              const objName = node.left.value;
              const keyName = node.right.value.replace(/^[`'"]|[`'"]$/g, '');
              
              if (this.recordTypes && this.recordTypes[objName] && this.recordTypes[objName].fields[keyName] !== undefined) {
                  const fieldOffset = this.recordTypes[objName].fields[keyName];
                  this.visit(node.left); // push object pointer
                  const objReg = this.vsp - 1;
                  
                  this.emit(`    // Static access to ${objName} '${keyName} (offset ${fieldOffset})`);
                  this.emit(`    fmov x0, d${objReg}`);
                  this.emit(`    ldr d${objReg}, [x0, #${fieldOffset}] // Load field`);
              } else {
                  this.emit(`    // Warning: Could not statically resolve property ${objName} '${keyName}`);
                  this.emit(`    fmov d${this.vsp++}, xzr`); // fallback
              }
           } else {
               this.emit(`    // Warning: Unresolved dynamic property access`);
               this.emit(`    fmov d${this.vsp++}, xzr`); // fallback
           }
           break;
        }

        if (node.op === '?') {
          this.lambdaCount++;
          const funcId = this.lambdaCount;
          const funcName = `func_${funcId}`;
          
          let isDestructuring = false;
          let headName = null;
          let tailName = null;
          let actualBody = node.right;
          let paramName = node.left ? node.left.value : "$tmp_arg";
          
          if (node.left && node.left.type === 'identifier') {
            if (node.right && node.right.type === 'infix' && node.right.op === '?') {
              if (node.right.left && node.right.left.type === 'prefix' && node.right.left.op === '~') {
                isDestructuring = true;
                headName = node.left.value;
                tailName = node.right.left.expr.value;
                actualBody = node.right.right;
                paramName = '$list_arg';
              }
            }
          }
          
          let freeVars = this.getFreeVariables(actualBody, [paramName, headName, tailName].filter(Boolean));
          // キャプチャ対象（現在のスコープにあるもの）のみを抽出
          freeVars = freeVars.filter(v => this.scopeOffsets[v] !== undefined);
  
          // --- Caller side: クロージャメモリの確保 ---
          const envSize = freeVars.length * 8;
          this.emit(`    // === Closure Allocation for ${funcName} ===`);
          this.emit(`    mov x0, #${16 + envSize}`);
          this.emit(`    stp x29, x30, [sp, #-16]!`);
          this.emit(`    bl _alloc_closure`);
          this.emit(`    ldp x29, x30, [sp], #16`);
          
          this.emit(`    mov x9, x0 // x9 holds closure ptr`);
          
          // 実行ポインタ(+0)
          this.emit(`    adrp x10, ${funcName}`);
          this.emit(`    add x10, x10, :lo12:${funcName}`);
          this.emit(`    str x10, [x9] // store function pointer at +0`);
          
          // 環境ポインタ(+8)
          if (envSize > 0) {
             this.emit(`    add x10, x9, #16`);
             this.emit(`    str x10, [x9, #8] // store env pointer at +8`);
          } else {
             this.emit(`    str xzr, [x9, #8] // null env pointer`);
          }
          
          // 環境変数のヒープコピー
          freeVars.forEach((v, idx) => {
             const offset = this.scopeOffsets[v];
             this.emit(`    ldr d30, [sp, #${offset}]  // free var ${v}`);
             this.emit(`    str d30, [x10, #${idx * 8}]`);
          });
  
          // 追加: 自己再帰関数のKnot Tying (遅延パッチ)
          const assignedName = node.assignedName;
          if (assignedName && freeVars.includes(assignedName)) {
             const idx = freeVars.indexOf(assignedName);
             this.emit(`    // Knot Tying: set self pointer to ${assignedName}`);
             this.emit(`    fmov d30, x9 // d30 = closure ptr itself`);
             this.emit(`    str d30, [x10, #${idx * 8}] // Overwrite its own env slot`);
          }

          this.emit(`    fmov d${this.vsp++}, x9 // push closure ptr as result`);
  
          // --- Lambda side: 関数本体のアセンブリ構築 ---
          const prevCode = this.code;
          const prevScopeOffsets = this.scopeOffsets;
          const prevCurrentScopeSize = this.currentScopeSize;
          const prevVsp = this.vsp; // 内部のVSPは0から再スタート
          const origEmitForLambda = this.emit;
  
          this.code = [];
          this.emit = (line) => this.code.push(line);

          this.scopeOffsets = { [paramName]: 0 }; // 第一引数は sp+0
          if (isDestructuring) {
             this.scopeOffsets[headName] = 8;
             this.scopeOffsets[tailName] = 16;
          }
          
          let nextOffset = isDestructuring ? 24 : 8;
          freeVars.forEach(v => {
             this.scopeOffsets[v] = nextOffset;
             nextOffset += 8;
          });
          this.currentScopeSize = nextOffset;
          this.collectVariables(actualBody); // 内部のローカル変数のオフセット計算
  
          const stackSize = (this.currentScopeSize + 15) & ~15;
  
          this.emit(`\n${funcName}:`);
          this.emit(`    stp x29, x30, [sp, #-16]!`);
          this.emit(`    mov x29, sp`);
          if (stackSize > 0) this.emit(`    sub sp, sp, #${stackSize}`);
  
          this.emit(`    // store parameter (d0) to local stack [sp, #0]`);
          this.emit(`    str d0, [sp, #0]`);
          
          if (isDestructuring) {
             this.emit(`    // Destructure argument pair (check if it's a pointer)`);
             this.emit(`    fmov x0, d0`); // assumed pointer
             this.emit(`    adrp x1, heap_space`);
             this.emit(`    add x1, x1, :lo12:heap_space`);
             this.emit(`    cmp x0, x1`);
             this.emit(`    blt destructure_invalid_${funcId}`);
             this.emit(`    add x2, x1, #1048576`); // 1MB heap space
             this.emit(`    cmp x0, x2`);
             this.emit(`    bge destructure_invalid_${funcId}`);
             this.emit(`    // Valid pointer`);
             this.emit(`    ldr d30, [x0] // head`);
             this.emit(`    str d30, [sp, #8]`);
             this.emit(`    ldr d30, [x0, #8] // tail`);
             this.emit(`    str d30, [sp, #16]`);
             this.emit(`    b destructure_end_${funcId}`);
             this.emit(`destructure_invalid_${funcId}:`);
             this.emit(`    adrp x0, fc_nan`);
             this.emit(`    add x0, x0, :lo12:fc_nan`);
             this.emit(`    ldr d30, [x0]`);
             this.emit(`    str d30, [sp, #8]`);
             this.emit(`    str d30, [sp, #16]`);
             this.emit(`destructure_end_${funcId}:`);
          }
          
          if (envSize > 0) {
             this.emit(`    // restore environment from x9`);
             freeVars.forEach(v => {
                const offset = this.scopeOffsets[v];
                this.emit(`    ldr d30, [x9, #${(freeVars.indexOf(v)) * 8}]`);
                this.emit(`    str d30, [sp, #${offset}]`);
             });
          }
  
          this.vsp = 0;
          
          let checkBody = actualBody && actualBody.type === 'group' ? actualBody.body : actualBody;
          const isMatchBlock = checkBody && (checkBody.type === 'block' || checkBody.type === 'ModuleBlock') &&
              checkBody.body && checkBody.body.length > 0 &&
              checkBody.body[0].type === 'infix' && checkBody.body[0].op === ':';

          if (isMatchBlock) {
             const exitLabel = `match_exit_${funcId}`;
             const branches = checkBody.body;
             const startVsp = this.vsp; // ALL branches must leave their result at startVsp
             
             let branchIndex = 0;
             for (const branch of branches) {
                 const branchLabel = `match_branch_${funcId}_${branchIndex}`;
                 const nextBranchLabel = `match_branch_${funcId}_${branchIndex + 1}`;
                 
                 this.emit(`${branchLabel}:`);
                 if (branch.type === 'infix' && branch.op === ':') {
                     let isComparison = false;
                     if (branch.left) {
                         if (branch.left.type === 'infix' && ['<', '>', '=', '!=', '<=', '>='].includes(branch.left.op)) {
                             isComparison = true;
                         }
                     }
                     if (isComparison) {
                         this.visit(branch.left);
                         const condReg = this.vsp - 1;
                         this.emit(`    fcmp d${condReg}, d${condReg}`);
                         this.emit(`    bvs ${nextBranchLabel} // If NaN (falsy), goto next branch`);
                         this.vsp--; // pop condition
                         
                         this.visit(branch.right, true);
                         this.emit(`    fmov d${startVsp}, d${this.vsp - 1}`);
                         this.emit(`    b ${exitLabel}`);
                     } else {
                         this.visit(branch.left);
                         const matchReg = this.vsp - 1;
                         const pOff = this.scopeOffsets[paramName];
                         this.emit(`    ldr d30, [sp, #${pOff}]`);
                         
                         // Deep equality check using _val_eq
                         this.emit(`    stp x29, x30, [sp, #-16]!`);
                         this.emit(`    fmov d0, d${matchReg}`);
                         this.emit(`    fmov d1, d30`);
                         this.emit(`    bl _val_eq`);
                         this.emit(`    fcmp d0, d0`); // true (1.0) -> VC, false (NaN) -> VS
                         this.emit(`    ldp x29, x30, [sp], #16`);
                         this.emit(`    bvs ${nextBranchLabel} // If false (NaN), goto next branch`);
                         
                         this.vsp--; // pop match pattern
                         
                         this.visit(branch.right, true);
                         this.emit(`    fmov d${startVsp}, d${this.vsp - 1} // store to fixed result reg`);
                         this.emit(`    b ${exitLabel}`);
                     }
                 } else {
                     this.visit(branch, true);
                     this.emit(`    fmov d${startVsp}, d${this.vsp - 1} // store to fixed result reg`);
                     this.emit(`    b ${exitLabel}`);
                 }
                 this.vsp = startVsp; // Restore VSP so next branch compiles from same base
                 branchIndex++;
             }
             this.emit(`match_branch_${funcId}_${branchIndex}:`);
             this.emit(`    adrp x0, fc_nan`);
             this.emit(`    add x0, x0, :lo12:fc_nan`);
             this.emit(`    ldr d${startVsp}, [x0]  // fallback NaN`);
             this.emit(`${exitLabel}:`);
             this.vsp = startVsp + 1; // Block leaves exactly one result
          } else {
             this.visit(actualBody, true); // 本体は常に末尾位置
          }

          if (this.vsp > 0) {
             this.emit(`    fmov d0, d${this.vsp - 1} // move result to d0`);
          } else {
             // Nothing returned
             this.emit(`    fmov d0, xzr // return Unit (0) if nothing`);
          }
  
          if (stackSize > 0) this.emit(`    add sp, sp, #${stackSize}`);
          this.emit('    ldp x29, x30, [sp], #16');
          this.emit('    ret');
  
          this.functions.push(...this.code); // 構築したコードを保存
  
          // ジェネレータの状態を元に戻す
          this.emit = origEmitForLambda;
          this.code = prevCode;
          this.scopeOffsets = prevScopeOffsets;
          this.currentScopeSize = prevCurrentScopeSize;
          this.vsp = prevVsp;
          break;
        }
        
        if (node.op === '|') {
          const skipLabel = `skip_or_${this.applyCount++}`;
          this.visit(node.left, false); // 左辺は絶対に末尾ジャンプしてはいけない（結果を判定するため）
          const leftReg = this.vsp - 1;
          
          // 自分自身と比較 (NaNであれば VS/Vフラグが立つ)
          this.emit(`    fcmp d${leftReg}, d${leftReg}`);
          this.emit(`    bvc ${skipLabel} // If LHS is not NaN (Truth), skip RHS`);
          
          // Falsy (NaN)の場合は右辺を評価して上書きする
          this.vsp--; // 左辺の値をポップ
          this.visit(node.right, isTail); 
          this.emit(`${skipLabel}:`);
          break;
        }

        this.visit(node.left);
        this.visit(node.right);
        
        if (this.vsp >= 2) {
          const rightReg = this.vsp - 1;
          const leftReg = this.vsp - 2;
          switch (node.op) {
            case '+': this.emit(`    fadd d${leftReg}, d${leftReg}, d${rightReg}`); break;
            case '-': this.emit(`    fsub d${leftReg}, d${leftReg}, d${rightReg}`); break;
            case '*': this.emit(`    fmul d${leftReg}, d${leftReg}, d${rightReg}`); break;
            case '/': this.emit(`    fdiv d${leftReg}, d${leftReg}, d${rightReg}`); break;
            case '%':
              this.emit(`    fdiv d30, d${leftReg}, d${rightReg}`);
              this.emit(`    frintz d30, d30 // trunc(a/b)`);
              this.emit(`    fmsub d${leftReg}, d${rightReg}, d30, d${leftReg} // a - b * trunc(a/b)`);
              break;
            case '^': 
            case '**':
              this.emit(`    stp x29, x30, [sp, #-16]!`);
              // Save all registers potentially clobbered by pow
              this.emit(`    fmov d0, d${leftReg}`);
              this.emit(`    fmov d1, d${rightReg}`);
              this.emit(`    bl pow`);
              this.emit(`    fmov d${leftReg}, d0`);
              this.emit(`    ldp x29, x30, [sp], #16`);
              break;
            case '||':
            case '&&':
            case ';;':
            case '<<':
            case '>>':
              this.emit(`    fcvtzs x9, d${leftReg}`);
              this.emit(`    fcvtzs x10, d${rightReg}`);
              if (node.op === '||') this.emit(`    orr x9, x9, x10`);
              if (node.op === '&&') this.emit(`    and x9, x9, x10`);
              if (node.op === ';;') this.emit(`    eor x9, x9, x10`);
              if (node.op === '<<') this.emit(`    lsl x9, x9, x10`);
              if (node.op === '>>') this.emit(`    asr x9, x9, x10`);
              this.emit(`    scvtf d${leftReg}, x9`);
              break;
            
            case '<':
            case '>':
            case '=':
            case '!=':
            case '<=':
            case '>=': {
               // どちらを意味のある値として残すか（デフォルトは左辺）
               let returnRight = false;
               if (node.left && (node.left.type === 'number' || node.left.type === 'string')) {
                  returnRight = true;
               }
               const retReg = returnRight ? rightReg : leftReg;
               
               let cond = 'eq';
               if (node.op === '<') cond = 'mi';
               else if (node.op === '>') cond = 'gt';
               else if (node.op === '=') cond = 'eq';
               else if (node.op === '!=') cond = 'ne';
               else if (node.op === '<=') cond = 'ls';
               else if (node.op === '>=') cond = 'ge';

               // d30 に False値 (NaN) を準備
               this.emit(`    adrp x0, fc_nan`);
               this.emit(`    add x0, x0, :lo12:fc_nan`);
               this.emit(`    ldr d30, [x0]  // d30 = NaN (False)`);
               
               if (node.op === '=' || node.op === '!=') {
                   // Deep equality check
                   this.emit(`    stp x29, x30, [sp, #-16]!`);
                   this.emit(`    fmov d0, d${leftReg}`);
                   this.emit(`    fmov d1, d${rightReg}`);
                   this.emit(`    bl _val_eq`);
                   if (node.op === '!=') {
                       this.emit(`    fcmp d0, d0 // V flag set if NaN`);
                       this.emit(`    adrp x0, fc_nan`);
                       this.emit(`    add x0, x0, :lo12:fc_nan`);
                       this.emit(`    ldr d1, [x0]`);
                       this.emit(`    fmov d0, 1.0`);
                       this.emit(`    fcsel d0, d0, d1, vs // If it WAS NaN (false), return 1.0. Else return NaN.`);
                   }
                   this.emit(`    fmov d${leftReg}, d0`);
                   this.emit(`    ldp x29, x30, [sp], #16`);
               } else {
                   this.emit(`    fcmp d${leftReg}, d${rightReg}`);
                   this.emit(`    fcsel d${leftReg}, d${retReg}, d30, ${cond}`);
               }
               break;
            }


            case '#':
              // output (ストア): 左辺のアドレスに右辺のデータを書き込む
              this.emit(`    fmov x0, d${leftReg} // get destination address`);
              this.emit(`    str d${rightReg}, [x0]  // store data`);
              // leftRegにポインタを残したままにするため、上書きはしない
              break;

            case ' ': { // 関数適用 または Cons 化の動的ディスパッチ
              const applyId = this.applyCount++;
              this.emit(`    // --- Apply or Cons Dispatch (ID: ${applyId}) ---`);
              this.emit(`    fmov x0, d${leftReg} // LHS pointer/value`);
              
              // closure_space 領域かチェック
              this.emit(`    adrp x1, closure_space`);
              this.emit(`    add x1, x1, :lo12:closure_space`);
              this.emit(`    cmp x0, x1`);
              this.emit(`    blt apply_not_closure_${applyId} // If LHS < closure_space, not a closure`);
              this.emit(`    add x2, x1, #1048576`); // 1MB size
              this.emit(`    cmp x0, x2`);
              this.emit(`    bge apply_not_closure_${applyId} // If LHS >= closure_space + 1MB, not a closure`);
    
              // --- 関数である場合: 呼び出し ---
              this.emit(`    ldr x2, [x0] // func_ptr from +0`);
              this.emit(`    ldr x9, [x0, #8] // env_ptr from +8`);
              this.emit(`    // --- [IMPORTANT] Prevent reg clobber during call ---`);
              for (let i = 0; i < leftReg; i++) {
                 this.emit(`    str d${i}, [sp, #-16]! // Caller-save FPU register`);
              }
              
              this.emit(`    fmov d0, d${rightReg} // Arg to d0`);
              
              if (isTail) {
                 this.emit(`    // === Tail Call Optimization (TCO) Jump ===`);
                 this.emit(`    mov sp, x29  // Restore SP to Frame Pointer (pops all locals and caller-saved FPUs!)`);
                 this.emit(`    ldp x29, x30, [sp], #16`);
                 this.emit(`    br x2 // Tail jump (No Return!)`);
              } else {
                 this.emit(`    stp x29, x30, [sp, #-16]!`);
                 this.emit(`    blr x2 // Dynamic Call!`);
                 this.emit(`    ldp x29, x30, [sp], #16`);
                 
                 if (leftReg !== 0) {
                     this.emit(`    fmov d${leftReg}, d0 // Save return value to destination FIRST`);
                 }
                 for (let i = leftReg - 1; i >= 0; i--) {
                    this.emit(`    ldr d${i}, [sp], #16 // Restore Caller-saved FPU`);
                 }
                 
                 this.emit(`    // Since we overwrote LHS, we MUST re-push it to the float array stack manually if we are popping rightReg!`);
                 // Actually dynamic dispatch `fmov d${leftReg}, d0` works.
                 
                 this.emit(`    b apply_end_${applyId}`);
              }
    
              // --- 関数でない場合: Cons (リスト化) ---
              this.emit(`apply_not_closure_${applyId}:`);
              this.emit(`    mov x0, #16`);
              this.emit(`    stp x29, x30, [sp, #-16]!`);
              this.emit(`    bl _alloc`);
              this.emit(`    ldp x29, x30, [sp], #16`);
              this.emit(`    str d${leftReg}, [x0]`);
              this.emit(`    str d${rightReg}, [x0, #8]`);
              
              if (isTail) {
                 this.emit(`    // Non-closure Fallback. Need to do normal return logic since we skipped blr...`);
                 this.emit(`    fmov d0, x0 // Set return pointer`);
                 this.emit(`    mov sp, x29 // Reclaim locals`);
                 this.emit(`    ldp x29, x30, [sp], #16`);
                 this.emit(`    ret`);
              } else {
                 this.emit(`    fmov d${leftReg}, x0 // pointer result`);
              }
              
              this.emit(`apply_end_${applyId}:`);
              break;
            }

            case ',':
              // Cons(リスト結合): 16バイトアロケートして、[x0]=left, [x0+8]=right。結果を左レジスタへポインタとして戻す
              this.emit(`    mov x0, #16`);
              this.emit(`    stp x29, x30, [sp, #-16]!`); // caller-saved 退避は本来もっと必要だが一旦簡易的に
              this.emit(`    bl _alloc`);
              this.emit(`    ldp x29, x30, [sp], #16`);
              this.emit(`    str d${leftReg}, [x0]`);
              this.emit(`    str d${rightReg}, [x0, #8]`);
              this.emit(`    fmov d${leftReg}, x0  // ポインタをFPUレジスタへ格納`);
              break;
            default: this.emit(`    // 未対応の演算子: ${node.op}`); break;
          }
          this.vsp--; // 右辺をポップ
        }
        break;
      case 'block':
      case 'group':
        if (node.body) {
            this.visit(node.body);
        }
        break;
      default:
         break;
    }
  }
}
