# Sign AArch64 テスト環境

このディレクトリ (`playground/test_aarch64`) は、Sign言語のソースコードから AArch64 (ARM64) アセンブリを生成し、それをコンパイル・実行して結果を確認するためのテスト環境です。

## 前提環境

このテスト環境は、Windows上の **WSL (Windows Subsystem for Linux)** を利用してクロスコンパイルおよびエミュレーション実行を行います。
実行には、以下のパッケージがWSL環境にインストールされている必要があります。

1. **AArch64 クロスコンパイラ**: `aarch64-linux-gnu-gcc`
2. **AArch64 エミュレータ**: `qemu-user` (`qemu-aarch64`)

### WSL側のセットアップコマンド
WSL内で以下のコマンドを実行し、必要なパッケージをインストールしてください。
（※Windowsのターミナルから直接行う場合は、先頭に `wsl` を付けて実行します）

```bash
sudo apt-get update
sudo apt-get install -y gcc-aarch64-linux-gnu qemu-user
```

## 使い方

Node.jsを使用して、テストランナー (`test_cli.js`) にSign言語のソースファイル (`.sn`) を渡します。

```powershell
node test_cli.js sample.sn
```

※モジュールの形式に関する警告 (`[MODULE_TYPELESS_PACKAGE_JSON] Warning...`) が出ますが、実行には影響ありません。

## 動作の仕組み（内部パイプライン）

`test_cli.js` を実行すると、以下の1〜5のステップが自動的に連続して行われます。

### 1. パース (Parsing)
入力された `.sn` ファイル（例: `sample.sn`）を読み込み、内部の `parser_browser.js` (Prattパーサー) によって構文解析を行い、生の抽象構文木 (AST) を生成します。

### 2. 正規化 (Normalizing)
パースされた生のASTを `ast_normalizer.js` に通し、中置演算子の整理や型の推論などを行い、コード生成しやすい正規化されたASTに変換します。

### 3. アセンブリ生成 (Code Generation)
正規化されたASTを `aarch64_generator.js` がトラバース（巡回）し、**Linux ABI準拠のAArch64アセンブリコード** (`output.s`) を生成します。
* 現状の実装（プロトタイプ版）では、数値を浮動小数点数（`.double`）として `.data` セクションに配置します。
* AArch64のFPUレジスタ (`d0`, `d1`, etc.) を用いた仮想スタックマシンとして四則演算モジュール（`fadd`, `fsub` 等）を展開します。
* 最終的な評価結果（トップスタックの値）を `d0` レジスタに格納し、C標準ライブラリの `printf` を呼び出して標準出力するように構成されています。

### 4. コンパイル (Compilation)
生成された `output.s` を対象に、WSL経由でクロスコンパイラを呼び出します。
```bash
wsl aarch64-linux-gnu-gcc -static output.s -o output.elf
```
これにより、AArch64アーキテクチャ上で動作する静的リンクされた実行可能バイナリ (`output.elf`) が作成されます。

### 5. 実行 (Execution)
コンパイルで得られたAArch64向けバイナリを、x86等のホストマシン上で動作させるため、WSL経由で `qemu-aarch64` エミュレータを使って実行します。
```bash
wsl qemu-aarch64 -L /usr/aarch64-linux-gnu ./output.elf
```
実行されると、アセンブリ内に組み込まれた `printf` 命令によって計算結果が出力され、Node.jsのコンソールに `[Execution Result]` として最終的な結果が表示されます。
