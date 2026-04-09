export class WatGenerator {
  constructor(locals) {
    this.locals = locals;
    this.code = [];
  }

  emit(line) {
    this.code.push(line);
  }

  // ⚡ 追加: 溜まった遅延パッチを一斉に適用するメソッド
  flushPatches() {
    if (this.patchQueue && this.patchQueue.length > 0) {
      this.patchQueue.forEach(patch => {
        this.emit(`    ;; Delayed Patch: ${patch.freeVar} into environment of ${patch.closureVar}`);
        this.emit(`    local.get ${patch.closureVar}`);
        this.emit(`    i64.reinterpret_f64`);
        this.emit(`    i32.wrap_i64`); // 関数ポインタの下位32ビット(環境ポインタ)を取り出す
        this.emit(`    local.get ${patch.freeVar}`);
        this.emit(`    f64.store offset=${patch.offset}`); // 最新の実体で上書き！
      });
      this.patchQueue = []; // 適用後はクリア
    }
  }

  generate(ast) {
    // ★ 仮想型スタックなどの初期化を追加
    this.typeStack = [];
    this.typeEnv = {};   // ★ 追加：変数の型を記憶するノート（シンボルテーブル）
    this.patchQueue = []; // ⚡ 追加: 相互再帰用の遅延パッチキュー
    this.functions = [];
    this.elemFuncs = [];
    this.lambdaCount = 0;

    this.emit('(module');
    this.emit('  (import "env" "math_pow" (func $math_pow (param f64 f64) (result f64)))');
    this.emit('  (import "env" "str_to_num" (func $str_to_num (param f64) (result f64)))');
    this.emit('  (import "env" "str_concat" (func $str_concat (param f64 f64) (result f64)))');

    this.emit('  (memory $mem 1)');
    this.emit('  (export "memory" (memory $mem))');
    this.emit('  (global $hp (mut i32) (i32.const 8))');
    // ★追加: 高階関数のためのテーブルと、クロージャ呼び出しの型シグネチャ
    this.emit('  (table $func_table 100 funcref)');
    // ⚡ 関数シグネチャを単一の「コンテキストリスト (ctx)」のみに変更
    this.emit('  (type $closure_sig (func (param f64) (result f64)))');
    // wat_generator.js の emit("module...") の後あたりに追加
    this.emit(`
  (func $is_ptr (param $val f64) (result i32)
    local.get $val
    i64.reinterpret_f64
    i64.const 0x7FFC000000000000
    i64.and
    i64.const 0x7FFC000000000000
    i64.eq
  )`);

    this.emit(`
  (func $f64_to_ptr (param $val f64) (result i32)
    local.get $val
    i64.reinterpret_f64
    i32.wrap_i64
  )`);

    // ★ , (積) の実体となるConsセル生成関数
    this.emit(`
  (func $cons (param $car f64) (param $cdr f64) (result f64)
    (local $ptr i32)

    local.get $car
    local.get $car
    f64.ne
    if
      local.get $car
      i64.reinterpret_f64
      i64.const 48
      i64.shr_u
      i32.wrap_i64
      i32.const 0x7FFF
      i32.and
      i32.const 0x7FF8
      i32.eq
      if
        local.get $cdr
        return
      end
    end
    i32.const 16
    call $alloc
    local.set $ptr
    local.get $ptr
    local.get $car
    f64.store offset=0
    local.get $ptr
    local.get $cdr
    f64.store offset=8
    local.get $ptr
    call $ptr_to_f64
  )`);


    this.emit(`
  (func $alloc (export "alloc") (param $size i32) (result i32)
    (local $ptr i32)
    global.get $hp
    local.set $ptr
    global.get $hp
    local.get $size
    i32.add
    global.set $hp
    local.get $ptr
  )`);

    this.emit(`
  (func $ptr_to_f64 (param $ptr i32) (result f64)
    local.get $ptr
    i64.extend_i32_u
    i64.const 0x7FFC000000000000
    i64.or
    f64.reinterpret_i64
  )`);

    // ★ 鉄壁のTruthy判定（0やすべてのポインタは真、純粋なNaNだけ偽）
    this.emit(`
  (func $is_truthy (param $val f64) (result i32)
    (local $tag i32)
    local.get $val
    local.get $val
    f64.eq
    if (result i32)
      i32.const 1
    else
      local.get $val
      i64.reinterpret_f64
      i64.const 32
      i64.shr_u
      i32.wrap_i64
      i32.const 0xFFFF0000
      i32.and
      local.set $tag
      
      local.get $tag
      i32.const 0x7FF90000
      i32.ge_u
    end
  )`);

    this.emit(`
  (func $fact (param $n f64) (result f64)
    (local $res f64)
    (local $i f64)
    local.get $n
    local.get $n
    f64.ne
    if
      f64.const nan
      return
    end
    local.get $n
    f64.const 0.0
    f64.lt
    if f64.const nan return end
    local.get $n
    f64.const 0.5
    f64.lt
    if f64.const 1.0 return end
    f64.const 1.0
    local.set $res
    local.get $n
    f64.trunc
    local.set $i
    block $break
      loop $loop
        local.get $i
        f64.const 1.0
        f64.lt
        br_if $break
        local.get $res
        local.get $i
        f64.mul
        local.set $res
        local.get $i
        f64.const 1.0
        f64.sub
        local.set $i
        br $loop
      end
    end
    local.get $res
  )`);

    // ⚡ 1. Pipeline Caller (Dispatcher) - 堅牢なポインタ渡し版
    this.emit(`
  (func $composed_caller (param $ctx f64) (result f64)
    (local $ctx_ptr i32)
    (local $arg f64)
    (local $env f64)
    (local $f f64)
    (local $g f64)
    (local $f_res f64)
    (local $new_ctx_ptr i32)

    local.get $ctx
    call $f64_to_ptr
    local.set $ctx_ptr
    
    local.get $ctx_ptr
    f64.load offset=0
    local.set $arg
    local.get $ctx_ptr
    f64.load offset=8
    local.set $env

    local.get $env
    call $f64_to_ptr
    local.set $ctx_ptr
    
    local.get $ctx_ptr
    f64.load offset=0
    local.set $f
    local.get $ctx_ptr
    f64.load offset=8
    local.set $g

    i32.const 16
    call $alloc
    local.set $new_ctx_ptr
    local.get $new_ctx_ptr
    local.get $arg
    f64.store offset=0
    local.get $new_ctx_ptr
    local.get $f
    i64.reinterpret_f64
    i64.const 0xFFFFFFFF
    i64.and
    i32.wrap_i64
    call $ptr_to_f64
    f64.store offset=8
    local.get $new_ctx_ptr
    call $ptr_to_f64
    
    local.get $f
    i64.reinterpret_f64
    i64.const 32
    i64.shr_u
    i32.wrap_i64
    call_indirect (type $closure_sig)
    local.set $f_res

    i32.const 16
    call $alloc
    local.set $new_ctx_ptr
    local.get $new_ctx_ptr
    local.get $f_res
    f64.store offset=0
    local.get $new_ctx_ptr
    local.get $g
    i64.reinterpret_f64
    i64.const 0xFFFFFFFF
    i64.and
    i32.wrap_i64
    call $ptr_to_f64
    f64.store offset=8
    local.get $new_ctx_ptr
    call $ptr_to_f64
    
    local.get $g
    i64.reinterpret_f64
    i64.const 32
    i64.shr_u
    i32.wrap_i64
    call_indirect (type $closure_sig)
  )`);

    // ⚡ 2. Compose function - 堅牢なポインタ取得版
    this.emit(`
  (func $compose (param $f f64) (param $g f64) (result f64)
    (local $env_ptr i32)
    local.get $f
    local.get $g
    call $cons
    
    call $f64_to_ptr
    local.set $env_ptr
    
    i64.const 99
    i64.const 32
    i64.shl
    local.get $env_ptr
    i64.extend_i32_u
    i64.or
    f64.reinterpret_i64
  )`);

    // ⚡ 3. List Concat (完全修正版)
    this.emit(`
  (func $list_concat (param $l1 f64) (param $l2 f64) (result f64)
    (local $curr_ptr i32)
    (local $cdr_val f64)

    local.get $l1
    call $is_ptr
    i32.eqz
    if
      local.get $l1
      local.get $l1
      f64.ne
      if
        local.get $l2
        return
      else
        local.get $l1
        local.get $l2
        call $cons
        return
      end
    end

    local.get $l1
    call $f64_to_ptr
    local.set $curr_ptr

    (loop $find_end
      local.get $curr_ptr
      f64.load offset=8
      local.set $cdr_val

      local.get $cdr_val
      call $is_ptr
      if
        local.get $cdr_val
        call $f64_to_ptr
        local.set $curr_ptr
        br $find_end
      end
    )

    local.get $cdr_val
    local.get $cdr_val
    f64.ne
    if
      local.get $curr_ptr
      local.get $l2
      f64.store offset=8
    else
      local.get $curr_ptr
      local.get $cdr_val
      local.get $l2
      call $cons
      f64.store offset=8
    end

    local.get $l1
  )`);

    // ⚡ 4. List Push (リストの末尾に要素を追加。Unitの混入を防ぐ)
    this.emit(`
  (func $list_push (param $list f64) (param $val f64) (result f64)
    (local $curr_ptr i32)
    (local $cdr_val f64)

    local.get $list
    call $is_ptr
    i32.eqz
    if
      local.get $list
      local.get $val
      call $cons
      return
    end

    local.get $list
    call $f64_to_ptr
    local.set $curr_ptr

    (loop $find_end
      local.get $curr_ptr
      f64.load offset=8
      local.set $cdr_val

      local.get $cdr_val
      call $is_ptr
      if
        local.get $cdr_val
        call $f64_to_ptr
        local.set $curr_ptr
        br $find_end
      end
    )

    local.get $cdr_val
    local.get $cdr_val
    f64.ne
    if
      local.get $curr_ptr
      local.get $val
      f64.const nan
      call $cons
      f64.store offset=8
    else
      local.get $curr_ptr
      local.get $cdr_val
      local.get $val
      call $cons
      f64.store offset=8
    end

    local.get $list
  )`);

    // ⚡ 5. List Unshift
    this.emit(`
  (func $list_unshift (param $val f64) (param $list f64) (result f64)
    local.get $val
    local.get $list
    call $cons
  )`);

    // ⚡ 6. List Flatten (後置 ~ の実体)
    this.emit(`
  (func $list_flatten (param $val f64) (result f64)
    (local $car f64)
    (local $cdr f64)

    local.get $val
    call $is_ptr
    i32.eqz
    if
      local.get $val
      return
    end

    local.get $val
    call $f64_to_ptr
    f64.load offset=0
    call $list_flatten
    local.set $car

    local.get $val
    call $f64_to_ptr
    f64.load offset=8
    call $list_flatten
    local.set $cdr

    local.get $car
    local.get $cdr
    call $list_concat
  )`);

    // ⚡ 7. Deep Search Equality (ディープ・サーチ・イコール)
    this.emit(`
  (func $val_eq (param $p1 f64) (param $p2 f64) (result i32)
    (local $ptr1 i32)
    (local $ptr2 i32)
    (local $tag1 i32)
    (local $tag2 i32)
    (local $len1 i32)
    (local $len2 i32)
    (local $i i32)

    local.get $p1
    i64.reinterpret_f64
    local.get $p2
    i64.reinterpret_f64
    i64.eq
    if i32.const 1 return end

    local.get $p1
    i64.reinterpret_f64
    i64.const 32
    i64.shr_u
    i32.wrap_i64
    i32.const 0xFFFF0000
    i32.and
    local.set $tag1

    local.get $p2
    i64.reinterpret_f64
    i64.const 32
    i64.shr_u
    i32.wrap_i64
    i32.const 0xFFFF0000
    i32.and
    local.set $tag2

    local.get $tag1
    local.get $tag2
    i32.ne
    if i32.const 0 return end

    local.get $tag1
    i32.const 0x7FFB0000
    i32.eq
    if
      local.get $p1
      call $f64_to_ptr
      local.set $ptr1
      local.get $p2
      call $f64_to_ptr
      local.set $ptr2

      local.get $ptr1
      i32.load offset=0
      local.set $len1
      local.get $ptr2
      i32.load offset=0
      local.set $len2

      local.get $len1
      local.get $len2
      i32.ne
      if i32.const 0 return end

      i32.const 0
      local.set $i
      (block $break
        (loop $compare_loop
          local.get $i
          local.get $len1
          i32.ge_u
          br_if $break

          local.get $ptr1
          local.get $i
          i32.add
          i32.load8_u offset=4
          local.get $ptr2
          local.get $i
          i32.add
          i32.load8_u offset=4
          i32.ne
          if i32.const 0 return end

          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $compare_loop
        )
      )
      i32.const 1
      return
    end

    local.get $tag1
    i32.const 0x7FFC0000
    i32.eq
    local.get $tag1
    i32.const 0x7FF40000
    i32.eq
    i32.or
    if
      local.get $p1
      call $f64_to_ptr
      f64.load offset=0
      local.get $p2
      call $f64_to_ptr
      f64.load offset=0
      call $val_eq
      i32.eqz
      if i32.const 0 return end

      local.get $p1
      call $f64_to_ptr
      f64.load offset=8
      local.get $p2
      call $f64_to_ptr
      f64.load offset=8
      call $val_eq
      return
    end

    i32.const 0
    return
  )`);

    // ⚡ 8. Dictionary Get (辞書/A-Listからの値取得)
    this.emit(`
  (func $dict_get (param $alist f64) (param $key f64) (result f64)
    (local $current_node i32)
    (local $pair_ptr i32)
    (local $current_key f64)

    local.get $alist
    call $is_ptr
    i32.eqz
    if
      f64.const nan
      return
    end

    local.get $alist
    call $f64_to_ptr
    local.set $current_node

    (block $exit
      (loop $search
        local.get $current_node
        i32.eqz
        br_if $exit

        local.get $current_node
        f64.load offset=0
        call $f64_to_ptr
        local.set $pair_ptr

        local.get $pair_ptr
        f64.load offset=0
        local.set $current_key

        local.get $current_key
        local.get $key
        call $val_eq
        if
          local.get $pair_ptr
          f64.load offset=8
          return
        end

        local.get $current_node
        f64.load offset=8
        call $f64_to_ptr
        local.set $current_node
        br $search
      )
    )
    f64.const nan
  )`);

    // ⚡ 追加: リストのN番目の要素を取得する $list_get 関数
    this.emit(`  (func $list_get (param $list f64) (param $index f64) (result f64)
    (local $idx i32)
    (local $curr f64)
    (local $ptr i32)
    local.get $index
    i32.trunc_f64_s
    local.set $idx
    local.get $list
    local.set $curr
    (block $exit (result f64)
      (loop $loop
        local.get $curr
        i64.reinterpret_f64
        i64.const 0x7FF8000000000000
        i64.eq
        if
          f64.const nan
          br $exit
        end
        
        local.get $curr
        call $f64_to_ptr
        local.set $ptr

        local.get $idx
        i32.eqz
        if
          local.get $ptr
          f64.load offset=0
          br $exit
        end
        
        local.get $idx
        i32.const 1
        i32.sub
        local.set $idx
        local.get $ptr
        f64.load offset=8
        local.set $curr
        br $loop
      )
      f64.const nan
    )
  )`);

    this.emit(`
  (func $dict_set (param $alist f64) (param $key f64) (param $val f64) (result f64)
    (local $current_node i32)
    (local $pair_ptr i32)
    (local $current_key f64)

    local.get $alist
    call $is_ptr
    i32.eqz
    if
      local.get $val
      return
    end

    local.get $alist
    call $f64_to_ptr
    local.set $current_node

    (block $exit
      (loop $search
        local.get $current_node
        i32.eqz
        br_if $exit

        local.get $current_node
        f64.load offset=0
        call $f64_to_ptr
        local.set $pair_ptr

        local.get $pair_ptr
        f64.load offset=0
        local.set $current_key

        local.get $current_key
        local.get $key
        call $val_eq
        if
          local.get $pair_ptr
          local.get $val
          f64.store offset=8
          local.get $val
          return
        end

        local.get $current_node
        f64.load offset=8
        call $f64_to_ptr
        local.set $current_node
        br $search
      )
    )
    local.get $val
  )`);

    // ⚡ 9. Memory Store (アドレスへの破壊的書き込み)
    this.emit(`
  (func $store_data (param $addr f64) (param $data f64) (result f64)
    local.get $addr
    call $f64_to_ptr
    local.get $data
    f64.store offset=0
    local.get $data
  )`);

    // ⚡ 10. String Map Add (文字列の各文字コードに数値を加算してリスト化する)
    this.emit(`
  (func $str_map_add (param $str f64) (param $num f64) (result f64)
    (local $str_ptr i32)
    (local $len i32)
    (local $i i32)
    (local $char_val f64)
    (local $list f64)

    local.get $str
    call $f64_to_ptr
    local.set $str_ptr

    local.get $str_ptr
    i32.load offset=0
    local.set $len

    f64.const nan
    local.set $list
    local.get $len
    local.set $i

    (block $break
      (loop $loop
        local.get $i
        i32.eqz
        br_if $break

        local.get $i
        i32.const 1
        i32.sub
        local.set $i

        local.get $str_ptr
        local.get $i
        i32.add
        i32.load8_u offset=4
        f64.convert_i32_u
        local.get $num
        f64.add
        local.set $char_val

        local.get $char_val
        local.get $list
        call $cons
        local.set $list
        br $loop
      )
    )
    local.get $list
  )`);

    // ⚡ 11. Range List Builder (中置 ~ の実体：A ~ B)
    this.emit(`
  (func $list_range (param $start f64) (param $end f64) (result f64)
    (local $list f64)
    (local $curr f64)
    (local $step f64)
    local.get $start
    local.get $end
    f64.gt
    if
      f64.const -1.0
      local.set $step
    else
      f64.const 1.0
      local.set $step
    end
    f64.const nan
    local.set $list
    local.get $end
    local.set $curr

    (block $break
      (loop $loop
        local.get $curr
        local.get $list
        call $cons
        local.set $list
        local.get $curr
        local.get $start
        f64.eq
        br_if $break
        local.get $curr
        local.get $step
        f64.sub
        local.set $curr

        br $loop
      )
    )
    local.get $list
  )`);

    // ===== ⚡ここから追加 (デモ版用: 有限範囲リスト構築関数群) =====
    this.emit(`
  (func $list_range_demo_add (param $curr f64) (param $step f64) (param $end f64) (result f64)
    local.get $step
    f64.const 0.0
    f64.eq
    if
      f64.const nan
      return
    end
    local.get $step
    f64.const 0.0
    f64.gt
    if (result i32)
      local.get $curr
      local.get $end
      f64.gt
    else
      local.get $curr
      local.get $end
      f64.lt
    end
    if
      f64.const nan
      return
    end
    local.get $curr
    local.get $curr
    local.get $step
    f64.add
    local.get $step
    local.get $end
    call $list_range_demo_add
    call $cons
  )

  (func $list_range_demo_mul (param $curr f64) (param $step f64) (param $end f64) (result f64)
    local.get $step
    f64.const 1.0
    f64.eq
    if
      f64.const nan
      return
    end
    local.get $step
    f64.const 1.0
    f64.gt
    if (result i32)
      local.get $curr
      local.get $end
      f64.gt
    else
      local.get $curr
      local.get $end
      f64.lt
    end
    if
      f64.const nan
      return
    end
    local.get $curr
    local.get $curr
    local.get $step
    f64.mul
    local.get $step
    local.get $end
    call $list_range_demo_mul
    call $cons
  )

  (func $list_range_demo_pow (param $curr f64) (param $step f64) (param $end f64) (result f64)
    local.get $curr
    local.get $end
    f64.gt
    if
      f64.const nan
      return
    end
    local.get $curr
    local.get $curr
    local.get $step
    call $math_pow
    local.get $step
    local.get $end
    call $list_range_demo_pow
    call $cons
  )`);
    // ===== ⚡ここまで追加 =====

    this.emit('  (func $main (export "main") (result f64)');

    // ★ 追加：変数の二重宣言を絶対に防ぐガード
    const declaredLocals = new Set();

    this.emit('    (local $tmp_ptr i32)');
    declaredLocals.add('tmp_ptr');

    // ⚡ 追加: ストリームマッチ用のターゲットレジスタ
    this.emit('    (local $tmp_match_target f64)');
    declaredLocals.add('tmp_match_target');

    this.emit('    (local $final_res f64)');
    declaredLocals.add('final_res');

    // this.locals の中身を展開（すでに tmp_l などが含まれていればここで一回だけ出力される）
    for (let l of this.locals) {
      if (!declaredLocals.has(l)) {
        this.emit(`    (local $${l} f64)`);
        declaredLocals.add(l);
      }
    }

    this.visit(ast);
    this.flushPatches(); // ⚡ 追加: トップレベルでの取りこぼしパッチを適用

    // ★ JSエンジンの破壊から守る0番地メールボックス
    this.emit('    local.set $final_res');
    this.emit('    i32.const 0');
    this.emit('    local.get $final_res');
    this.emit('    f64.store offset=0');
    this.emit('    local.get $final_res');
    this.emit('  )'); // ★ $mainの終わり

    // ★ ここに追加: 見つけたラムダ関数をモジュール末尾に出力
    if (this.functions.length > 0) {
      this.functions.forEach(line => this.emit(line));

      // ⚡ IDの順番通りにテーブルのリストを作成する
      const funcList = [];
      for (let i = 1; i <= this.lambdaCount; i++) {
        funcList.push(this.elemFuncs[i]);
      }
      this.emit(`  (elem (i32.const 1) ${funcList.join(' ')})`);
    }

    // ★ ここに追加：関数合成用のディスパッチャを 99番地 に登録する
    this.emit(`  (elem (i32.const 99) $composed_caller)`);

    this.emit(')'); // ★ $mainの終わりじゃなくてモジュールの終わり

    return this.code.join('\n');
  }

  visit(node) {
    if (!node) { this.emit('    f64.const nan'); return; }

    if (Array.isArray(node)) {
      if (node.length === 0) { this.emit('    f64.const nan'); return; }
      for (let i = 0; i < node.length; i++) {
        this.visit(node[i]);
        if (i < node.length - 1) this.emit('    drop');
      }
      return;
    }

    if (node.type === 'block') {
      const body = node.body || [];
      if (body.length === 0) { this.emit('    f64.const nan'); return; }

      // ⚡ [究極の改善] ブロックの脱出ラベル (ガード節による早期リターンのため)
      const blockLabel = `$block_exit_${Math.floor(Math.random() * 1000000)}`;
      this.emit(`    (block ${blockLabel} (result f64)`);

      for (let i = 0; i < body.length; i++) {
        let expr = body[i];

        // ⚡ 追加: 代入(:)以外の式を実行する直前に、未解決のパッチを一斉適用する
        let isAssignment = expr.type === 'infix' && expr.op === ':';
        if (!isAssignment) {
          this.flushPatches();
        }

        // ⚡ ガード節 ( 例: token = Unit ? Unit ) の検知
        let isGuard = false;
        if (expr.type === 'infix' && expr.op === '?') {
          let left = expr.left;
          let isLambdaDef = false; // 左辺がラムダの引数か判定
          if (left && (left.type === 'identifier' || left.type === 'variable')) isLambdaDef = true;
          else if (left && left.type === 'prefix' && left.op === '~') isLambdaDef = true;

          if (!isLambdaDef) isGuard = true;
        }

        if (isGuard) {
          this.visit(expr.left);
          this.emit(`    call $is_truthy`);
          this.emit(`    if`);
          this.visit(expr.right);
          this.emit(`    br ${blockLabel}`); // 真なら評価して即座にブロックを抜ける！
          this.emit(`    end`);

          if (i === body.length - 1) {
            this.emit(`    f64.const nan`); // 最後の式が偽だった場合のフォールバック
          }
        } else {
          // 通常の式の評価
          this.visit(expr);
          if (i < body.length - 1) {
            this.emit('    drop');
            if (this.typeStack) this.typeStack.pop();
          }
        }
      }
      this.emit(`    )`); // ブロック終了
      return;
    }

    switch (node.type) {
      // ===== ⚡ここから追加 =====
      case 'RangeDemo':
        this.visit(node.start);

        // 演算子の意味に合わせてステップ値を前処理する
        if (node.op === '~/') {
          this.emit(`    f64.const 1.0`);
          this.visit(node.step);
          this.emit(`    f64.div`); // step = 1.0 / step
        } else if (node.op === '~-') {
          this.emit(`    f64.const 0.0`);
          this.visit(node.step);
          this.emit(`    f64.sub`); // step = 0.0 - step
        } else {
          this.visit(node.step);
        }

        this.visit(node.end);

        // 変化規則に応じて呼び出すWASM関数を切り替える
        if (node.op === '~*' || node.op === '~/') {
          this.emit(`    call $list_range_demo_mul`);
        } else if (node.op === '~^') {
          this.emit(`    call $list_range_demo_pow`);
        } else {
          this.emit(`    call $list_range_demo_add`);
        }

        if (this.typeStack) this.typeStack.push({ type: 'List' });
        return;
      // ===== ⚡ここまで追加 =====

      // ⚡ =========================================================
      // ⚡ 追加: ブロック(改行)の順次実行と平坦なリスト化(辞書構築)
      // ⚡ =========================================================
      case 'BlockSeq':
        this.visit(node.left);

        let bLeftType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };
        let isSideEffect = (bLeftType && bLeftType.type === 'SideEffect') || (node.left && node.left.op === '#');

        if (isSideEffect) {
          this.emit(`    drop`); // ⚡ 15などの副作用のゴミを完全に捨てる！
          if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
          this.visit(node.right); // 右側(f fooなど)をそのまま評価して返す
        } else {
          // 副作用でなければ平坦に結合 (元のコンパイラの正常なA-List構築)
          this.visit(node.right);
          this.emit(`    call $cons`);
          if (this.typeStack && this.typeStack.length >= 2) {
            this.typeStack.pop(); this.typeStack.pop();
            this.typeStack.push({ type: 'Dict' });
          }
        }
        return;

      // ⚡ =========================================================
      // ⚡ スマートフロントエンドからの「意味確定ノード」の受け口
      // ⚡ =========================================================

      case 'CommaNode':
        this.visit(node.left);
        // 左辺の型をスタックから覗き見
        let cLeftType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };

        this.visit(node.right);
        // 右辺の型をスタックから覗き見
        let cRightType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };

        const isRightComma = node.right && node.right.type === 'CommaNode';
        // パーサーが自動付与した Unit(nan) かどうかを判定
        const isRightUnit = node.right && (
          node.right.value === 'nan' || node.right.name === 'nan' || node.right.text === 'nan' ||
          node.right.value === '_' || node.right.name === '_' || node.right.text === '_' ||
          node.right.type === 'Unit'
        );

        // ⚡ 右辺をリスト化（右辺がカンマ連鎖でもUnitでもSpreadListでもない場合のみ、終端nanを付与）
        if (!isRightComma && !isRightUnit && cRightType.type !== 'SpreadList') {
          this.emit(`    f64.const nan`);
          this.emit(`    call $cons`);
        }

        // ⚡ 左辺と右辺の結合 (SpreadListならconcatで融合、そうでなければconsで階層化)
        if (cLeftType && cLeftType.type === 'SpreadList') {
          this.emit(`    call $list_concat`);
        } else {
          this.emit(`    call $cons`);
        }

        if (this.typeStack) {
          if (this.typeStack.length >= 2) { this.typeStack.pop(); this.typeStack.pop(); }
          this.typeStack.push({ type: 'List' });
        }
        return;

      case 'ProductNode':
        this.visit(node.left);
        let pLeftType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };

        this.visit(node.right);
        let pRightType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };

        // ⚡ 平坦な結合 (余計な nan や 2回の cons は絶対に書かない！)
        if ((pLeftType && pLeftType.type === 'SpreadList') || (pRightType && pRightType.type === 'SpreadList')) {
          this.emit(`    call $list_concat`);
        } else {
          this.emit(`    call $cons`);
        }

        if (this.typeStack) {
          if (this.typeStack.length >= 2) { this.typeStack.pop(); this.typeStack.pop(); }
          // 辞書の型タグ復元
          let isDict = false;
          if (pLeftType && pLeftType.type === 'String') isDict = true;
          else if (pLeftType && pLeftType.type === 'Dict' && (pRightType && (pRightType.type === 'Dict' || pRightType.type === 'Unit' || pRightType.type === 'Unknown'))) isDict = true;
          this.typeStack.push({ type: isDict ? 'Dict' : 'List' });
        }
        return;

      case 'SequenceNode':
        this.visit(node.left);
        this.emit(`    drop`); // 副作用のゴミを捨てる
        this.visit(node.right);
        if (this.typeStack && this.typeStack.length >= 2) {
          let rightT = this.typeStack.pop();
          this.typeStack.pop();
          this.typeStack.push(rightT);
        }
        return;

      case 'ApplyNode':
        this.compileInfix({ ...node, type: 'infix', op: ' ' });
        return;

      case 'ComposeNode':
        // 関数合成 (WASM側に $compose 関数が存在する前提のプレースホルダー)
        this.visit(node.left);
        this.visit(node.right);
        this.emit(`    call $compose`);
        if (this.typeStack) {
          this.typeStack.pop(); this.typeStack.pop();
          this.typeStack.push({ type: 'Function' });
        }
        return;
      // ⚡ =========================================================

      case 'number':
        let numVal = Number(node.value);
        if (Number.isNaN(numVal)) {
          this.emit(`    f64.const nan`);
        } else {
          this.emit(`    f64.const ${numVal}`);
        }
        if (this.typeStack) this.typeStack.push({ type: 'Float' }); // ★ 追加：数値の型を記憶
        break;

      // ==========================================
      // ⚡ [追加] 文字型 (Char) ノードの処理
      // ==========================================
      case 'char':
        this.emit(`    i32.const ${node.value}`);
        this.emit(`    i64.extend_i32_u`);
        // ポインタ(0x7FFC~)と衝突しない独自のCharタグ(0x7FFA~)を付与
        this.emit(`    i64.const 0x7FFA000000000000`);
        this.emit(`    i64.or`);
        this.emit(`    f64.reinterpret_i64`); // NaN-Box化してスタックに積む

        if (this.typeStack) this.typeStack.push({ type: 'Char' });
        break;
      // ==========================================

      // ==========================================
      // ⚡ [追加] 文字列 (String) ノードの処理
      // ==========================================
      case 'string': {
        // 1. バッククォートの安全な除去
        let strVal = node.value;
        if (strVal.startsWith('`') && strVal.endsWith('`')) {
          strVal = strVal.slice(1, -1);
        }

        // 2. UTF-8バイト列へのエンコード
        const encoder = new TextEncoder();
        const bytes = encoder.encode(strVal);
        const len = bytes.length;

        // 3. メモリ確保 (文字列長: 4バイト + 本体: lenバイト)
        this.emit(`    i32.const ${len + 4}`);
        this.emit(`    call $alloc`);
        this.emit(`    local.set $tmp_ptr`);

        // 4. 文字列長の保存 (先頭4バイト, i32)
        this.emit(`    local.get $tmp_ptr`);
        this.emit(`    i32.const ${len}`);
        this.emit(`    i32.store offset=0`);

        // 5. 各バイトデータの保存
        for (let i = 0; i < len; i++) {
          this.emit(`    local.get $tmp_ptr`);
          this.emit(`    i32.const ${bytes[i]}`);
          this.emit(`    i32.store8 offset=${4 + i}`);
        }

        // 6. ポインタをNaN-Box化してスタックに積む
        this.emit(`    local.get $tmp_ptr`);
        this.emit(`    i64.extend_i32_u`);
        this.emit(`    i64.const 0x7FFB000000000000`);
        this.emit(`    i64.or`);
        this.emit(`    f64.reinterpret_i64`);

        // 型スタックにStringを記憶
        if (this.typeStack) this.typeStack.push({ type: 'String' });
        break;
      }
      // ==========================================

      case 'identifier':
      case 'variable':
        // ⚡ 修正: node.value などが数値(Number)で渡ってきても文字列にキャストする
        const varName = String(node.name || node.value || node.text);

        if (varName === '_' || varName === 'nan') {
          this.emit(`    f64.const nan`);
          if (this.typeStack) this.typeStack.push({ type: 'Float' });
        } else {
          // キャスト済みなので startsWith が安全に使える
          const wasmVarName = varName.startsWith('$') ? varName : '$' + varName;

          // ⚡ 修正: マッチコンテキスト(~)の中にいる場合は、まず辞書から値を探す
          if (this.currentMatchTarget) {
            this.emit(`    local.get ${this.currentMatchTarget}`);

            let rawName = varName.startsWith('$') ? varName.slice(1) : varName;
            this.visit({ type: 'string', value: '\`' + rawName + '\`' });
            if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

            this.emit(`    call $dict_get`);

            this.emit(`    local.set $tmp_cond`);
            this.emit(`    local.get $tmp_cond`);
            this.emit(`    local.get $tmp_cond`);
            this.emit(`    f64.eq`); // 値が NaN でないか（見つかったか）判定
            this.emit(`    if (result f64)`);
            this.emit(`      local.get $tmp_cond`); // 辞書から見つかった値を使う
            this.emit(`    else`);
            this.emit(`      local.get ${wasmVarName}`); // 見つからなければ通常のローカル変数にフォールバック
            this.emit(`    end`);
          } else {
            // 通常の変数呼び出し
            this.emit(`    local.get ${wasmVarName}`);
          }

          // ⚡ 修正: wasmVarName($付き) と varName の両方で型環境を検索
          let savedType = null;
          if (this.typeEnv) {
            savedType = this.typeEnv[wasmVarName] || this.typeEnv[varName];
          }
          if (!savedType && node.inferredType) {
            savedType = node.inferredType;
          }
          // Signでは未知の変数は高階関数の可能性が高いため Function として扱う
          if (!savedType) {
            savedType = { type: 'Function', returnType: { type: 'Any' } };
          }

          if (this.typeStack) this.typeStack.push(savedType);
        }
        break;
      case 'absolute':
      case 'abs':
      case 'math_abs': {
        let absInner = node.expr || node.argument || node.operand || node.left || node.right || node.base || node.body || node.content || node.value;
        this.visit(absInner);
        this.emit(`    f64.abs`);
        break;
      }
      case 'group':
      case 'surround':
      case 'enclosure':
      case 'paren': {
        let isAbs = (node.surround === '|' || node.bracket === '|' || node.op === '|' || node.value === '|' || node.name === '|');
        let inner = node.body || node.content || node.expr || node.value || node.operand || node.argument || node.left || node.right;
        this.visit(inner);
        if (isAbs) {
          this.emit(`    f64.abs`);
        }
        break;
      }
      case 'prefix':
        this.compilePrefix(node);
        break;
      case 'postfix':
        this.compilePostfix(node);
        break;
      case 'infix':
        this.compileInfix(node);
        break;
      default:
        // ★ 未知のノードタイプが来たらエラー
        throw new Error(`[WASM Compiler] Unsupported node type: "${node.type}"`);
    }
  }

  compilePrefix(node) {
    const op = node.op || node.value;
    const operand = node.right || node.left || node.expr || node.argument || node.operand || node.base || node.value;

    this.visit(operand);

    switch (op) {
      case '-': this.emit(`    f64.neg`); break;
      case '+': break;
      case '|': this.emit(`    f64.abs`); break;

      // ★ 単体値の Lift (ポインタ化)
      case '$':
        this.emit(`    local.set $tmp_l`);      // スタックの値を一時退避
        this.emit(`    i32.const 8`);           // f64一つ分(8バイト)のメモリを要求
        this.emit(`    call $alloc`);
        this.emit(`    local.set $tmp_ptr`);    // 確保したアドレスを退避
        this.emit(`    local.get $tmp_ptr`);
        this.emit(`    local.get $tmp_l`);
        this.emit(`    f64.store offset=0`);    // ヒープへ持ち上げ（保存）
        this.emit(`    local.get $tmp_ptr`);
        this.emit(`    i64.extend_i32_u`);
        this.emit(`    i64.const 0x7FF9000000000000`);
        this.emit(`    i64.or`);
        this.emit(`    f64.reinterpret_i64`);
        break;

      // ★ 単体値の Flat (値の取り出し)
      case '@':
        this.emit(`    call $f64_to_ptr`);      // NaN-Box化されたアドレスをi32に戻す
        this.emit(`    f64.load offset=0`);     // ヒープからスタックへ持ち下げ（読み出し）
        break;

      case '!':
        this.emit(`    local.set $tmp_cond`);
        this.emit(`    local.get $tmp_cond`);
        this.emit(`    call $is_truthy`);
        this.emit(`    if (result f64)`);
        this.emit(`      f64.const nan`);
        this.emit(`    else`);
        this.emit(`      f64.const inf`);
        this.emit(`    end`);
        break;
      case '!!':
        this.emit(`    i32.trunc_f64_s`);
        this.emit(`    i32.const -1`);
        this.emit(`    i32.xor`);
        this.emit(`    f64.convert_i32_s`);
        break;
      // ★ リストへの Lift (単一値を長さ1のリストにする)
      case '~':
        this.emit(`    f64.const nan`);
        this.emit(`    call $cons`);
        if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
        if (this.typeStack) this.typeStack.push({ type: 'List' }); // ★ List型として積む
        break;
      default:
        throw new Error(`[WASM Compiler] Unsupported prefix operator: "${op}"`);
    }
  }

  compilePostfix(node) {
    const op = node.op || node.value;
    const operand = node.left || node.right || node.expr || node.argument || node.operand || node.base || node.value;
    this.visit(operand);
    switch (op) {
      case '!': this.emit(`    call $fact`); break;
      case '|': break;

      // ==========================================
      // ⚡ リストの Flat (平坦化・スプレッド展開)
      // ==========================================
      case '~':
        this.emit(`    call $list_flatten`);
        if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
        if (this.typeStack) this.typeStack.push({ type: 'SpreadList' }); // ★ スプレッド展開済みタグを積む
        break;

      default: throw new Error(`[WASM Compiler] Unsupported postfix operator: "${op}"`);
    }
  }

  compileInfix(node) {
    const { op, left, right } = node;

    if (op === '?') {
      // ⚡ 修正: 左辺がラムダの引数定義であるかを厳密に判定
      let isLambdaDef = false;
      if (left && (left.type === 'identifier' || left.type === 'variable')) {
        isLambdaDef = true;
      } else if (left && left.type === 'prefix' && left.op === '~') {
        isLambdaDef = true;
      }

      if (isLambdaDef) {
        this.compileLambda(node);
      } else {
        // インラインのガード節 (ブロック内ではなく単独で評価された場合)
        this.visit(left);
        this.emit(`    call $is_truthy`);
        this.emit(`    if (result f64)`);
        this.visit(right);
        this.emit(`    else`);
        this.emit(`      f64.const nan`);
        this.emit(`    end`);
      }
      return;
    }

    if (op === ' ') {
      this.compileSpace(node);
      return;
    }

    // ==========================================
    // ⚡ カンマ(,)の究極の静的ディスパッチ (ブロック・辞書・リテラルの完全統合)
    // ==========================================
    if (op === ',') {
      // ⚡ 1. 実行順序を絶対に守るため、まず左辺を評価する (無限ループ防止)
      this.visit(left);

      let leftType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };

      // ⚡ [Mode A] 左辺が副作用（Prism #）の場合 -> 順次実行モード
      let isSideEffect = (leftType && leftType.type === 'SideEffect') || (left && left.op === '#');
      if (isSideEffect) {
        this.emit(`    drop`); // 15などのゴミを捨てる
        if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

        // 右辺の不要な nan を剥がす処理
        let isRightNan = right && right.right && (right.right.value === 'nan' || right.right.name === 'nan' || right.right.text === 'nan');
        if (right && right.type === 'infix' && right.op === ',' && isRightNan) {
          this.visit(right.left);
        } else {
          this.visit(right);
        }
        return;
      }

      // ⚡ 2. 副作用でなければ右辺を評価する
      this.visit(right);
      let rightType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack.pop() : { type: 'Unknown' };
      if (this.typeStack && this.typeStack.length > 0) {
        leftType = this.typeStack.pop(); // 左辺の型を取り出す
      }

      // スプレッド展開の処理 (維持)
      if ((leftType && leftType.type === 'SpreadList') || (rightType && rightType.type === 'SpreadList')) {
        this.emit(`    call $list_concat`);
        if (this.typeStack) this.typeStack.push({ type: 'List' });
        return;
      }

      // ⚡ [Mode B] 左辺がペア(:)や辞書の場合 -> 辞書構築モード (平坦に結合)
      let isDictOrPair = (left && left.op === ':') || (leftType && (leftType.type === 'Pair' || leftType.type === 'Dict' || leftType.type === 'String'));
      if (isDictOrPair) {
        this.emit(`    call $cons`);
        if (this.typeStack) this.typeStack.push({ type: 'Dict' });
        return;
      }

      // 右辺がさらにカンマ(連鎖)なら、そのままconsするだけでリストが美しく伸びる
      if (right && right.op === ',') {
        this.emit(`    call $cons`);
      } else {
        // 連鎖の最後(または単発)なら、右辺をnanで閉じてから持ち上げる
        this.emit(`    f64.const nan`);
        this.emit(`    call $cons`);
        this.emit(`    call $cons`);
      }

      if (this.typeStack) this.typeStack.push({ type: 'List' });
      return;
    }

    // ==========================================
    // ⚡ 辞書からの値取得 (')
    // ==========================================
    if (op === "'") {
      this.visit(left);

      // ⚡ 追加: 動的アクセスと静的アクセスの分岐
      let isDynamic = false;
      if (right && right.type === 'postfix' && (right.op === '~' || right.value === '~')) {
        isDynamic = true;
      }

      if (isDynamic) {
        // 動的アクセス (~ による強制評価)
        const rExpr = right.left || right.right || right.expr || right.argument || right.operand || right.base || right.value;
        this.visit(rExpr);
      } else if (right && (right.type === 'identifier' || right.type === 'variable')) {
        // 静的アクセス (暗黙の文字列化)
        let rName = String(right.name || right.value || right.text);
        // ⚡ ガード: test_all.txt にある list ' 0 などを壊さないため、数値は文字列化しない
        if (!isNaN(Number(rName))) {
          this.visit(right);
        } else {
          this.visit({ type: 'string', value: '\`' + rName + '\`' });
        }
      } else {
        // その他 (文字列リテラルや数値など)
        this.visit(right);
      }

      let rightType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack[this.typeStack.length - 1] : { type: 'Unknown' };

      // ⚡ 数値なら $list_get、それ以外は $dict_get に分岐
      if (rightType && rightType.type === 'Float') {
        this.emit(`    call $list_get`);
      } else {
        this.emit(`    call $dict_get`);
      }

      if (this.typeStack && this.typeStack.length >= 2) {
        this.typeStack.pop(); this.typeStack.pop();
        this.typeStack.push({ type: 'Unknown' });
      }
      return;
    }

    // ==========================================
    // ⚡ アドレスへのデータ関連付け/書き込み (#)
    // ==========================================
    if (op === '#') {
      // ⚡ Prism: 左辺が識別子で、ストリームマッチ（~）の中であれば辞書更新
      if (left && (left.type === 'identifier' || left.type === 'variable') && this.currentMatchTarget) {
        this.emit(`    local.get ${this.currentMatchTarget}`);

        // ⚡ 修正: String() で確実に文字列キャストする
        let rawName = String(left.name || left.value || left.text);
        rawName = rawName.startsWith('$') ? rawName.slice(1) : rawName;
        this.visit({ type: 'string', value: '\`' + rawName + '\`' });
        if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

        this.visit(right);
        if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

        this.emit(`    call $dict_set`);
        if (this.typeStack) this.typeStack.push({ type: 'SideEffect' }); // ⚡ 副作用タグ
        return;
      }

      // 通常のアドレス書き込み ($x # 20 など)
      this.visit(left);
      if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
      this.visit(right);
      if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

      this.emit(`    call $store_data`);
      if (this.typeStack) {
        this.typeStack.push({ type: 'SideEffect' }); // ⚡ 副作用タグ
      }
      return;
    }

    if (op === ':') {
      let isDynamicKey = false;
      let isStaticKey = false;
      let lName = "";
      let lExpr = null;

      // ⚡ 1. 動的キー判定 (@プレフィックス)
      if (left && left.type === 'prefix' && (left.op === '@' || left.value === '@')) {
        isDynamicKey = true;
        lExpr = left.right || left.left || left.expr || left.argument || left.operand || left.base || left.value;
      }
      // ⚡ 2. 変数バインディングか、静的キーかの判定
      else if (left && (left.type === 'identifier' || left.type === 'variable')) {
        lName = String(left.name || left.value || left.text);
        // 数値なら変数ではなくリテラルキーとして扱う
        if (!isNaN(Number(lName))) {
          isStaticKey = false;
        } else {
          const checkName = lName.startsWith('$') ? lName.slice(1) : lName;
          // ローカル変数のリストになければ、辞書のキー（静的キー）と見なす
          if (!this.locals || !this.locals.includes(checkName)) {
            isStaticKey = true;
          }
        }
      }

      // ⚡ ペア(辞書エントリ)の生成処理
      if (isDynamicKey || isStaticKey || (left && left.type === 'string') || (left && left.type === 'number')) {
        if (isDynamicKey) {
          this.visit(lExpr); // 変数を評価
        } else if (isStaticKey) {
          this.visit({ type: 'string', value: '\`' + lName + '\`' }); // 暗黙の文字列化
        } else {
          this.visit(left); // stringやnumberの場合はそのまま
        }

        this.visit(right);
        this.emit(`    call $cons`);
        this.emit(`    f64.const nan`);
        this.emit(`    call $cons`);

        if (this.typeStack) {
          this.typeStack.push({ type: 'Dict' });
        }
        return;
      }

      // ⚡ ここから下は変数バインディング（代入）の処理 (最新コードを完全に維持)
      let isVar = left && (left.type === 'identifier' || left.type === 'variable');
      let rawVal = isVar ? (left.name || left.value || left.text) : null;
      let varName = rawVal != null ? String(rawVal) : null;
      let wasmName = varName ? (varName.startsWith('$') ? varName : '$' + varName) : null;

      // 事前登録: 自己再帰のために、中身を評価する「前」にカリー化シグネチャを登録する
      if (wasmName && right && right.type === 'infix' && right.op === '?') {
        right.assignedName = wasmName; // 自己参照キャプチャ用
        if (!this.typeEnv) this.typeEnv = {};

        // ASTを先読みして Function -> Function -> Any のシグネチャを構築
        const buildFuncType = (astNode) => {
          if (astNode && astNode.type === 'infix' && astNode.op === '?') {
            return { type: 'Function', returnType: buildFuncType(astNode.right) };
          }
          return { type: 'Any' };
        };
        this.typeEnv[wasmName] = buildFuncType(right);
      }

      this.visit(right);
      let rhsType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack.pop() : { type: 'Any' };

      if (wasmName) {
        if (!this.typeEnv) this.typeEnv = {};
        this.typeEnv[wasmName] = rhsType; // 実際の評価結果で正確に上書き

        this.emit(`    local.set $tmp_l`);
        this.emit(`    local.get $tmp_l`);
        this.emit(`    local.set ${wasmName}`);
        this.emit(`    local.get $tmp_l`);
      }

      if (this.typeStack) this.typeStack.push(rhsType);
      return;
    }

    // ★ フラットなif文による安定した論理評価
    if (op === '|') {
      this.visit(left);
      this.emit(`    local.set $tmp_l`);
      this.emit(`    local.get $tmp_l`);
      this.emit(`    call $is_truthy`);
      this.emit(`    if (result f64)`);
      this.emit(`      local.get $tmp_l`);
      this.emit(`    else`);
      this.visit(right);
      this.emit(`    end`);
      return;
    }
    if (op === '&') {
      this.visit(left);
      this.emit(`    local.set $tmp_l`);
      this.emit(`    local.get $tmp_l`);
      this.emit(`    call $is_truthy`);
      this.emit(`    if (result f64)`);
      this.visit(right);
      this.emit(`    else`);
      this.emit(`      f64.const nan`);
      this.emit(`    end`);
      return;
    }

    // ⚡ 型を推論しながらスタックに積む
    this.visit(left);
    let leftType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack.pop() : { type: 'Unknown' };

    this.visit(right);
    let rightType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack.pop() : { type: 'Unknown' };

    switch (op) {
      case '+':
        if (leftType.type === 'String') {
          // ⚡ 修正: 文字列を左辺に置いた加算は仕様外として、値を破棄して Unit (nan) を返す
          this.emit(`    drop`); // 右辺の値をWASMスタックから捨てる
          this.emit(`    drop`); // 左辺の文字列ポインタをWASMスタックから捨てる
          this.emit(`    f64.const nan`); // 代わりに Unit を積む
          if (this.typeStack) this.typeStack.push({ type: 'Unit' }); // 型推論も Unit に更新
        } else if (rightType.type === 'String') {
          this.emit(`    call $str_to_num`);
          this.emit(`    f64.add`);
          if (this.typeStack) this.typeStack.push({ type: 'Float' });
        } else {
          this.emit(`    f64.add`);
          if (this.typeStack) this.typeStack.push({ type: 'Float' });
        }
        break;
      case '-': this.emit(`    f64.sub`); break;
      case '~':
        this.emit(`    call $list_range`);
        if (this.typeStack) this.typeStack.push({ type: 'List' });
        break;
      case '*': this.emit(`    f64.mul`); break;
      case '/': this.emit(`    f64.div`); break;
      case '^':
      case '**': this.emit(`    call $math_pow`); break;
      case '%':
        this.emit(`    local.set $tmp_r`);
        this.emit(`    local.set $tmp_l`);
        this.emit(`    local.get $tmp_l`);
        this.emit(`    local.get $tmp_l`);
        this.emit(`    local.get $tmp_r`);
        this.emit(`    f64.div`);
        this.emit(`    f64.floor`);
        this.emit(`    local.get $tmp_r`);
        this.emit(`    f64.mul`);
        this.emit(`    f64.sub`);
        break;
      case '!':
        this.emit(`    drop`);
        this.emit(`    call $fact`);
        break;
      case '||':
      case '&&':
      case ';;':
      case '<<':
      case '>>':
        this.emit(`    local.set $tmp_r`);
        this.emit(`    local.set $tmp_l`);
        this.emit(`    local.get $tmp_l`);
        this.emit(`    i32.trunc_f64_s`);
        this.emit(`    local.get $tmp_r`);
        this.emit(`    i32.trunc_f64_s`);
        if (op === '||') this.emit(`    i32.or`);
        if (op === '&&') this.emit(`    i32.and`);
        if (op === ';;') this.emit(`    i32.xor`);
        if (op === '<<') this.emit(`    i32.shl`);
        if (op === '>>') this.emit(`    i32.shr_s`);
        this.emit(`    f64.convert_i32_s`);
        break;
      case '<':
      case '>':
      case '=':
      case '!=':
      case '<=':
      case '>=':
        // opだけでなく、leftとrightのノード情報も渡す
        this.compileComparison(op, left, right);
        break;

      // ★ 防犯ブザー：知らない演算子が来たらエラーで止める！
      default:
        throw new Error(`[WASM Compiler] Unsupported infix operator: "${op}"`);
    }
  }

  compileComparison(op, leftNode, rightNode) {
    this.emit(`    local.set $tmp_r`);
    this.emit(`    local.set $tmp_l`);
    this.emit(`    local.get $tmp_l`);
    this.emit(`    local.get $tmp_r`);
    switch (op) {
      case '<': this.emit(`    f64.lt`); break;
      case '>': this.emit(`    f64.gt`); break;

      // ⚡ 変更: f64.eq ではなく $val_eq を呼ぶ
      case '=':
        this.emit(`    call $val_eq`);
        break;

      // ⚡ 変更: $val_eq を呼んでから結果(i32)を反転させる
      case '!=':
        this.emit(`    call $val_eq`);
        this.emit(`    i32.eqz`);
        break;

      case '<=': this.emit(`    f64.le`); break;
      case '>=': this.emit(`    f64.ge`); break;
    }

    // ★追加：どちらの値を「意味のある値」として返すか静的に判定
    let returnRight = false;
    if (leftNode && rightNode) {
      // 左辺が純粋なリテラル（数値や文字列）であれば、右辺（変数や式）を返す
      if (leftNode.type === 'number' || leftNode.type === 'string') {
        returnRight = true;
      }
    }

    this.emit(`    if (result f64)`);
    if (returnRight) {
      this.emit(`      local.get $tmp_r`);
    } else {
      this.emit(`      local.get $tmp_l`);
    }
    this.emit(`    else`);
    this.emit(`      f64.const nan`);
    this.emit(`    end`);
  }

  // ⚡ 修正: initialBoundArray (配列) を受け取るように変更
  getFreeVariables(node, initialBoundArray) {
    let freeVars = new Set();

    const traverse = (n, bound) => {
      if (!n) return;
      if (n.type === 'identifier' || n.type === 'variable') {
        const vName = n.name || n.value || n.text;
        const normalizedName = vName.startsWith('$') ? vName : '$' + vName;

        if (!bound.has(normalizedName) && normalizedName !== '$_' && normalizedName !== '$nan') {
          freeVars.add(normalizedName);
        }
      } else if (n.type === 'infix') {
        if (n.op === '?') {
          const newBound = new Set(bound);
          let pName = n.left.name || n.left.value || n.left.text;

          // ~b のような接頭辞付きパラメータの救済
          if (!pName && n.left.type === 'prefix' && n.left.op === '~') {
            pName = n.left.expr.name || n.left.expr.value || n.left.expr.text;
          }
          if (pName) newBound.add(pName.startsWith('$') ? pName : '$' + pName);

          traverse(n.right, newBound);
        } else {
          traverse(n.left, bound);
          traverse(n.right, bound);
        }
      } else if (n.type === 'block') {
        (n.body || []).forEach(stmt => traverse(stmt, bound));
      } else if (n.type === 'apply' || n.type === 'call') {
        traverse(n.func || n.fn || n.callee || n.left, bound);
        traverse(n.arg || n.args || n.right, bound);
      } else {
        // ⚡ 追加: group など未知のノード内にある変数も、漏れなくキャプチャする！
        ['left', 'right', 'expr', 'body', 'content', 'start', 'step', 'end', 'func', 'arg'].forEach(key => {
          if (n[key] && typeof n[key] === 'object') {
            if (Array.isArray(n[key])) n[key].forEach(c => traverse(c, bound));
            else traverse(n[key], bound);
          }
        });
      }
    };

    traverse(node, new Set(initialBoundArray));
    return Array.from(freeVars);
  }

  compileLambda(node) {
    this.lambdaCount++;
    const funcId = this.lambdaCount;
    const funcName = `$lambda_${funcId}`;

    let isDestructuring = false;
    let headName = null;
    let tailName = null;
    let actualBody = node.right;

    // ⚡ 修正: 通常のラムダの引数名(paramName)を確実に取得する
    let pName = node.left && (node.left.name || node.left.value || node.left.text);
    if (!pName && node.left && node.left.type === 'prefix' && node.left.op === '~') {
      pName = node.left.expr && (node.left.expr.name || node.left.expr.value || node.left.expr.text);
    }
    let paramName = pName ? (pName.startsWith('$') ? pName : '$' + pName) : '$tmp_arg';

    // ==========================================
    // ⚡ 1. 構造分解 ( a ~b ? ... ) の検知
    // パーサーが a ? (~b ? ...) と解釈したものをフラット化
    // ==========================================
    if (node.left && (node.left.type === 'identifier' || node.left.type === 'variable')) {
      if (node.right && node.right.type === 'infix' && node.right.op === '?') {
        if (node.right.left && node.right.left.type === 'prefix' && node.right.left.op === '~') {
          isDestructuring = true;
          let hName = node.left.name || node.left.value || node.left.text;
          let tName = node.right.left.expr.name || node.right.left.expr.value || node.right.left.expr.text;
          headName = hName.startsWith('$') ? hName : '$' + hName;
          tailName = tName.startsWith('$') ? tName : '$' + tName;
          actualBody = node.right.right;
          paramName = '$list_arg'; // 引数全体(リスト)の一時変数
        }
      }
    }

    // ⚡ 2. キャプチャ解析
    let allReferencedVars;
    if (isDestructuring) {
      allReferencedVars = this.getFreeVariables(actualBody, [headName, tailName]);
    } else {
      allReferencedVars = this.getFreeVariables(actualBody, [paramName]);
    }

    // ⚡ 修正: キャプチャ(環境に保存)するのは、現在のスコープ(外側)に実際に存在する変数のみ！
    // 辞書のキー等として使われた未定義変数を外側で get してWASMエラーになるのを防ぐ
    let freeVars = allReferencedVars.filter(v => {
      let raw = v.startsWith('$') ? v.slice(1) : v;
      return this.locals.includes(raw) || this.locals.includes(v);
    });

    // ==========================================
    // ⚡ [CALLER] 外側の環境（クロージャ）の確保
    // ==========================================
    const envSize = freeVars.length * 8;
    if (envSize > 0) {
      this.emit(`    i32.const ${envSize}`);
      this.emit(`    call $alloc`);
      this.emit(`    local.set $tmp_ptr`);

      freeVars.forEach((v, idx) => {
        this.emit(`    local.get $tmp_ptr`);
        this.emit(`    local.get ${v}`);
        this.emit(`    f64.store offset=${idx * 8}`);
      });
    } else {
      this.emit(`    i32.const 0`);
      this.emit(`    local.set $tmp_ptr`);
    }

    this.emit(`    i64.const ${funcId}`);
    this.emit(`    i64.const 32`);
    this.emit(`    i64.shl`);
    this.emit(`    local.get $tmp_ptr`);
    this.emit(`    i64.extend_i32_u`);
    this.emit(`    i64.or`);
    this.emit(`    f64.reinterpret_i64`);

    // ⚡ 追加: [Letrec] 再帰関数のための自己参照結び（Knot Tying）
    let assignedName = node.assignedName;
    if (assignedName && freeVars.includes(assignedName)) {
      let idx = freeVars.indexOf(assignedName);
      this.emit(`    local.set $tmp_l`);               // 生成したクロージャのポインタを退避
      this.emit(`    local.get $tmp_ptr`);             // 環境（env）のポインタを取得
      this.emit(`    local.get $tmp_l`);               // 退避したポインタ
      this.emit(`    f64.store offset=${idx * 8}`);    // 環境内の自分自身のスロットを上書き！
      this.emit(`    local.get $tmp_l`);               // ポインタをスタックに戻す
    }

    // ⚡ ここから追加: 相互再帰のための遅延パッチキューへの登録
    if (assignedName) {
      freeVars.forEach((v, idx) => {
        // 自分自身以外(相互再帰の対象など)をパッチ候補としてキューに積む
        if (v !== assignedName) {
          this.patchQueue.push({
            closureVar: assignedName,
            freeVar: v,
            offset: idx * 8
          });
        }
      });
    }
    // ⚡ ここまで追加

    // ==========================================
    // ⚡ [LAMBDA] 内側の関数定義
    // ==========================================
    const prevCode = this.code;
    const prevLocals = this.locals;
    const prevTypeStack = this.typeStack;

    this.code = [];
    // ⚡ 修正: this.locals には関数内で言及される全ての変数を入れ、未定義エラーを防ぐ
    this.locals = [paramName, ...allReferencedVars];
    if (isDestructuring) {
      this.locals.push(headName, tailName);
    }
    this.typeStack = [];

    this.emit(`  (func ${funcName} (param $ctx f64) (result f64)`);
    this.emit(`    (local $tmp_l f64)`);
    this.emit(`    (local $tmp_r f64)`);
    this.emit(`    (local $tmp_cond f64)`);
    this.emit(`    (local $tmp_ptr i32)`);
    this.emit(`    (local $tmp_match_target f64)`);

    // ⚡ 修正: 重複を排除してローカル変数を一括宣言する
    let declaredLambdaLocals = new Set();
    const addLocal = (name) => {
      let wasmName = name.startsWith('$') ? name : '$' + name;
      if (!declaredLambdaLocals.has(wasmName)) {
        this.emit(`    (local ${wasmName} f64)`);
        declaredLambdaLocals.add(wasmName);
      }
    };

    addLocal(paramName);
    if (isDestructuring) {
      addLocal(headName);
      addLocal(tailName);
    }
    this.emit(`    (local $env f64)`);
    this.emit(`    (local $ctx_ptr i32)`);

    // ⚡ 修正: 関数内で言及された全ての変数をダミー宣言してWASMエラーを防ぐ
    allReferencedVars.forEach(v => addLocal(v));

    this.emit(`    local.get $ctx`);
    this.emit(`    call $f64_to_ptr`);
    this.emit(`    local.set $ctx_ptr`);

    this.emit(`    local.get $ctx_ptr`);
    this.emit(`    f64.load offset=0`);
    this.emit(`    local.set ${paramName}`);

    this.emit(`    local.get $ctx_ptr`);
    this.emit(`    f64.load offset=8`);
    this.emit(`    local.set $env`);

    if (freeVars.length > 0) {
      this.emit(`    local.get $env`);
      this.emit(`    call $f64_to_ptr`);
      this.emit(`    local.set $tmp_ptr`);

      freeVars.forEach((v, idx) => {
        this.emit(`    local.get $tmp_ptr`);
        this.emit(`    f64.load offset=${idx * 8}`);
        this.emit(`    local.set ${v}`);
      });
    }

    // ==========================================
    // ⚡ 3. リストの構造分解アセンブリ出力
    // ==========================================
    if (isDestructuring) {
      this.emit(`    local.get ${paramName}`);
      this.emit(`    call $is_ptr`);
      this.emit(`    if`);
      this.emit(`      local.get ${paramName}`);
      this.emit(`      call $f64_to_ptr`);
      this.emit(`      f64.load offset=0`);
      this.emit(`      local.set ${headName}`);

      this.emit(`      local.get ${paramName}`);
      this.emit(`      call $f64_to_ptr`);
      this.emit(`      f64.load offset=8`);
      this.emit(`      local.set ${tailName}`);
      this.emit(`    else`);
      this.emit(`      f64.const nan`);
      this.emit(`      local.set ${headName}`);
      this.emit(`      f64.const nan`);
      this.emit(`      local.set ${tailName}`);
      this.emit(`    end`);
    }

    // ⚡ 修正: group が被っている場合は中身(body)を対象にする
    let checkBody = actualBody && actualBody.type === 'group' ? actualBody.body : actualBody;

    const isMatchBlock = checkBody && checkBody.type === 'block' &&
      checkBody.body && checkBody.body.length > 0 &&
      checkBody.body[0].type === 'infix' && checkBody.body[0].op === ':';

    if (isMatchBlock) {
      this.emit(`    (block $match_exit (result f64)`);

      for (let i = 0; i < checkBody.body.length; i++) {
        const branch = checkBody.body[i];

        if (branch.type === 'infix' && branch.op === ':') {
          let isWildcard = false;
          let isComparison = false;

          if (branch.left) {
            if (branch.left.type === 'infix' && ['<', '>', '=', '!=', '<=', '>='].includes(branch.left.op)) {
              isComparison = true;
            }
            const leftVal = branch.left.value || branch.left.name || branch.left.text;
            if (leftVal === '_' || leftVal === 'nan') {
              isWildcard = true;
            }
          }

          if (isWildcard) {
            this.visit(branch.right);
            if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
            this.emit(`      br $match_exit`);
          } else if (isComparison) {
            this.visit(branch.left);
            if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

            // ⚡ 比較演算子は f64.eq を使い、NaNでない場合のみ成功とする
            this.emit(`      local.set $tmp_cond`);
            this.emit(`      local.get $tmp_cond`);
            this.emit(`      local.get $tmp_cond`);
            this.emit(`      f64.eq`);
            this.emit(`      if`);

            this.visit(branch.right);
            if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
            this.emit(`      br $match_exit`);
            this.emit(`      end`);
          } else {
            this.visit(branch.left);
            if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
            this.emit(`      local.get ${paramName}`);
            this.emit(`      call $val_eq`);
            this.emit(`      if`);
            this.visit(branch.right);
            if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
            this.emit(`      br $match_exit`);
            this.emit(`      end`);
          }
        } else {
          this.visit(branch);
          if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
          this.emit(`      br $match_exit`);
        }
      }

      this.emit(`      f64.const nan`);
      this.emit(`    )`);

      if (this.typeStack) this.typeStack.push({ type: 'Any' });

    } else {
      this.visit(actualBody);
    }

    let returnType = this.typeStack.length > 0 ? this.typeStack.pop() : { type: 'Float' };

    this.emit(`  )`); // 関数終了

    this.functions.push(...this.code);
    this.elemFuncs[funcId] = funcName;

    this.code = prevCode;
    this.locals = prevLocals;
    this.typeStack = prevTypeStack;

    if (this.typeStack) {
      this.typeStack.push({ type: 'Function', id: funcId, returnType: returnType });
    }
  }

  compileSpace(node) {
    let rightNode = node.right && node.right.type === 'group' ? node.right.body : node.right;

    const isStreamMatch = node.left && node.left.type === 'postfix' && node.left.op === '~' &&
      rightNode && (rightNode.type === 'block' || (rightNode.type === 'infix' && rightNode.op === ':'));

    if (isStreamMatch) {
      this.visit(node.left.expr);
      if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

      this.emit(`    local.set $tmp_match_target`);
      this.emit(`    (block $stream_match_exit (result f64)`);

      const branches = rightNode.type === 'block' ? (rightNode.body || []) : [rightNode];

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        // ⚡ 修正: マッチターゲットは上書きするが、null で消去はしない
        let prevTarget = this.currentMatchTarget;
        this.currentMatchTarget = '$tmp_match_target';

        if (branch.type === 'infix' && branch.op === ':') {
          let isMatchCase = false;
          let isWildcard = false;
          let isComparison = false;

          if (branch.left) {
            if (branch.left.type === 'infix' && ['<', '>', '=', '!=', '<=', '>='].includes(branch.left.op)) {
              isMatchCase = true;
              isComparison = true;
            }
            const leftVal = branch.left.value || branch.left.name || branch.left.text;
            if (leftVal === '_' || leftVal === 'nan' || (branch.left.type === 'number' && isNaN(Number(leftVal)))) {
              isMatchCase = true;
              isWildcard = true;
            }
          }

          if (isMatchCase) {
            if (isWildcard) {
              this.visit(branch.right);
              if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
              this.emit(`      br $stream_match_exit`);
            } else if (isComparison) {
              this.visit(branch.left);
              if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

              this.emit(`      local.set $tmp_cond`);
              this.emit(`      local.get $tmp_cond`);
              this.emit(`      local.get $tmp_cond`);
              this.emit(`      f64.eq`);
              this.emit(`      if`);

              this.visit(branch.right);
              if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();

              this.emit(`      br $stream_match_exit`);
              this.emit(`      end`);
            }
          } else {
            // Dictionary property style
            if (branch.left.type === 'identifier' || branch.left.type === 'variable') {
              let keyName = branch.left.name || branch.left.value || branch.left.text;
              this.visit({ type: 'string', value: '\`' + keyName + '\`' });
            } else {
              this.visit(branch.left);
            }
            this.visit(branch.right);

            this.emit(`    call $cons`);
            if (i < branches.length - 1) {
              this.emit(`      drop`);
            } else {
              this.emit(`      br $stream_match_exit`);
            }
          }
        } else {
          this.visit(branch);

          if (this.typeStack && this.typeStack.length > 0) this.typeStack.pop();
          if (i === branches.length - 1) {
            this.emit(`      br $stream_match_exit`);
          } else {
            this.emit(`      drop`);
          }
        }

        // ⚡ 修正: 元のコンテキストに戻す
        this.currentMatchTarget = prevTarget;
      }

      this.emit(`      f64.const nan`);
      this.emit(`    )`);
      if (this.typeStack) this.typeStack.push({ type: 'Any' });
      return;
    }

    // ⚡ 純粋な関数適用(カリー化)のディスパッチ
    this.visit(node.left || node.func);
    let leftType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack.pop() : { type: 'Unknown' };

    if (leftType.type === 'SideEffect') {
      this.emit(`    drop`);
      this.visit(node.right || node.arg);
      return;
    }

    this.visit(node.right || node.arg);
    let rightType = (this.typeStack && this.typeStack.length > 0) ? this.typeStack.pop() : { type: 'Unknown' };

    // ⚡ 未知の型やAnyも、適用時は関数(Function)として強気に呼び出す！
    const isLeftFunc = leftType.type === 'Function' || leftType.type === 'Any' || leftType.type === 'Unknown';
    const isRightFunc = rightType.type === 'Function';

    if (isLeftFunc && isRightFunc) {
      this.emit(`    call $compose`);
      if (this.typeStack) this.typeStack.push({ type: 'Function', returnType: leftType.returnType || { type: 'Any' } });

    } else if (isLeftFunc) {
      this.emit(`    local.set $tmp_r`); // arg
      this.emit(`    local.set $tmp_l`); // func

      // ⚡ 動的タグチェック: 左辺のタグ(上位16ビット)を取得して分岐
      this.emit(`    local.get $tmp_l`);
      this.emit(`    i64.reinterpret_f64`);
      this.emit(`    i64.const 32`);
      this.emit(`    i64.shr_u`);
      this.emit(`    i32.wrap_i64`);
      this.emit(`    i32.const 0xFFFF0000`);
      this.emit(`    i32.and`);
      this.emit(`    local.set $tmp_ptr`); // タグを一時保存

      // 1. 文字列(0x7FFB0000) または 文字(0x7FFA0000) の場合 -> str_concat
      this.emit(`    local.get $tmp_ptr`);
      this.emit(`    i32.const 0x7FFB0000`);
      this.emit(`    i32.eq`);
      this.emit(`    local.get $tmp_ptr`);
      this.emit(`    i32.const 0x7FFA0000`);
      this.emit(`    i32.eq`);
      this.emit(`    i32.or`);
      this.emit(`    if (result f64)`);
      this.emit(`      local.get $tmp_l`);
      this.emit(`      local.get $tmp_r`);
      this.emit(`      call $str_concat`);
      this.emit(`    else`);

      // 2. その他の値やリスト(0x7FF00000以上)の場合 -> 関数ではないので cons に逃がす
      this.emit(`      local.get $tmp_ptr`);
      this.emit(`      i32.const 0x7FF00000`);
      this.emit(`      i32.ge_u`);
      this.emit(`      if (result f64)`);
      this.emit(`        local.get $tmp_l`);
      this.emit(`        local.get $tmp_r`);
      this.emit(`        call $cons`);
      this.emit(`      else`);

      // 3. 本当の関数クロージャ(IDが上位にいる場合) -> call_indirect
      this.emit(`        i32.const 16`);
      this.emit(`        call $alloc`);
      this.emit(`        local.set $tmp_ptr`);

      this.emit(`        local.get $tmp_ptr`);
      this.emit(`        local.get $tmp_r`);
      this.emit(`        f64.store offset=0`);

      this.emit(`        local.get $tmp_ptr`);
      this.emit(`        local.get $tmp_l`);
      this.emit(`        i64.reinterpret_f64`);
      this.emit(`        i64.const 0xFFFFFFFF`);
      this.emit(`        i64.and`);
      this.emit(`        i32.wrap_i64`);
      this.emit(`        call $ptr_to_f64`);
      this.emit(`        f64.store offset=8`);

      this.emit(`        local.get $tmp_ptr`);
      this.emit(`        call $ptr_to_f64`);

      this.emit(`        local.get $tmp_l`);
      this.emit(`        i64.reinterpret_f64`);
      this.emit(`        i64.const 32`);
      this.emit(`        i64.shr_u`);
      this.emit(`        i32.wrap_i64`);
      this.emit(`        call_indirect (type $closure_sig)`);

      this.emit(`      end`);
      this.emit(`    end`);

      // デフォルトを Any にして想定外のリスト化フォールバックを防ぐ
      let retType = leftType.returnType || { type: 'Any' };
      if (this.typeStack) this.typeStack.push(retType);

    } else if (leftType.type === 'List' && rightType.type === 'List') {
      this.emit(`    call $list_concat`);
      if (this.typeStack) this.typeStack.push({ type: 'List' });

    } else if (leftType.type === 'String' || rightType.type === 'String' || leftType.type === 'Char' || rightType.type === 'Char') {
      this.emit(`    call $str_concat`);
      if (this.typeStack) this.typeStack.push({ type: 'String' });

    } else if (leftType.type === 'List') {
      this.emit(`    call $list_push`);
      if (this.typeStack) this.typeStack.push({ type: 'List' });

    } else if (rightType.type === 'List') {
      this.emit(`    call $list_unshift`);
      if (this.typeStack) this.typeStack.push({ type: 'List' });

    } else {
      this.emit(`    call $cons`);
      if (this.typeStack) this.typeStack.push({ type: 'List' });
    }
  }
}