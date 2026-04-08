{
  let typeTable = {
  };

  let context = {
    indentStack : [],
    indent : ""
  };
}


Start = Program

//空白必須
__ = sp:" "+ { return }

//空白可
_ = " "* { return }

//行頭
SOL = &{ return location().start.column === 1; }

//行末
EOL = "\r\n" / "\r" / "\n"

Program = (Expression / Comment)

Comment = (SOL "`" [^\r\n]* EOL)*

Expression
  = SOL Definition EOL* (SOL Definition EOL*)*
  / Verification (EOL+ Verification)*
  / ""

Definition
  = Export            //エクスポート
  / Define            //定義（名前を付けてオブジェクトを束縛する）

Verification
  = Output
  / Applicate         //関数適用
  / Construct         //ラムダ、リスト、辞書型の構築、関数合成
  / Calculate         //ALUで扱う演算の集合で、優先順位を定義する必要ある
  / Expand            //展開する
  / Address           //メモリアドレスの取得
  / Get               //辞書型やリストの中から値を取得
  / Compute           //Bit演算だけ行う
  / Input             //アドレスから値を取得
  / Import            //別ファイルからのインポート
  / Block             //式のブロック
  / EOL?

Export = ("###" / "##" / "#")? Define

Define
  = name:identifier _ ":" _ (
     EOL Indent dict:Dictionary Dedent { typeTable[name] = {...dict}; }
    / (PointFree / Lambda)  { typeTable[name] = "function"; }
    / list:(DirectProduct / DirectSum) { typeTable[name] = list; }
    / string { typeTable[name] = "string"; }
    / Verification
    / Atom
    / Define
  )

Output
  = (address / identifier / Address) __ "#" __ (Applicate / Output)
  / Applicate

Applicate
  = (Closure / Get / function) (__ DirectProduct)*
  / DirectProduct

Construct
  = Dictionary
  / Closure
  / DirectProduct
  / DirectSum
  / Compose

Dictionary
  = name:identifier _ ":" _ (
      (PointFree / Lambda)  { typeTable[name] = "function"; }
    / EOL Expand EOL dict:Dictionary { typeTable[name] = {...dict}; }
    / EOL Indent dict:Dictionary Dedent { typeTable[name] = {...dict}; }
    / list:(DirectProduct / DirectSum) { typeTable[name] = list; }
    / string { typeTable[name] = "string"; }
    / Verification
    / Atom
  )

Closure
  = "[" (Lambda / PointFree) "]"
  / "{" (Lambda / PointFree) "}"
  / "(" (Lambda / PointFree) ")"

Lambda
  = Arguments _ "?" _ (Output / Lambda)
  / Arguments _ "?" EOL Indent ((Match_Case / Output) EOL)* Dedent

Arguments = Continuous / Defaultive

Defaultive
  = "[" EOL Indent (identifier _ ":" _ Verification EOL)+ Dedent "]"
  / "{" EOL Indent (identifier _ ":" _ Verification EOL)+ Dedent "}"
  / "(" EOL Indent (identifier _ ":" _ Verification EOL)+ Dedent ")"

Match_Case = Calculate ":" Verification

PointFree
  = DirectMap
  / Normal
  / DirectFold

DirectMap
  =  prefix "_" ","
  / "_" postfix ","
  / (number / address / register) _ infix ","
  / infix _ (number / address / register) ","

Normal
  = (number / address / register) _ infix
  / infix _ (number / address / register)

DirectFold = _ infix _

DirectProduct
  = DirectSum (_ "," _ DirectProduct)?
  / Compose
  / Continuous
  / Sequence

DirectSum = (Continuous / Sequence / Calculate) (__ (Continuous / Sequence / Calculate))*

Compose
  = (Closure / function) (__ (Closure / function))*
  / Sequence

Sequence //無限リストも表現可能
  = "[" SequenceInner "]"
  / "{" SequenceInner "}"
  / "(" SequenceInner ")"

SequenceInner
  = (number / Arithmetic) _ ("~+" / "~-" / "~*" / "~/" / "~^") _ (number / Arithmetic) __ "~" __ (number / Arithmetic)
  / (number / Arithmetic) _ ("~+" / "~-" / "~*" / "~/" / "~^") _ (number / Arithmetic)
  / (number / Arithmetic) __ "~" __ (number / Arithmetic)
  / (number / Arithmetic) __ "~"
  / "~" __ (number / Arithmetic)

Continuous = "~"? Calculate (__ "~"? Calculate)*

Calculate = Logical_Xor
Logical_Xor = Logical_Or (_ ";" _ Logical_Or)*
Logical_Or = Logical_And (__ "|" __ Logical_And)*
Logical_And = Logical_Not (_ "&" _ Logical_Not)*
Logical_Not = "!"? Compare

Compare = Arithmetic (_ ("<" / "<=" / "=" / "==" /">=" / ">" / "!=") _ Arithmetic)*

Arithmetic = Additive

Additive = Multiply (_ ("+" / __ "-" __) _ Multiply)*
Multiply = Expornential (_ ("*" / "/" / "%") _ Expornential)*

Expornential
  = Factorial (_ "^" _ Expornential)*
  / Factorial

Factorial = Absolute "!"?

Absolute
  = "|" (Additive / CalculateBlock) "|"
  / CalculateBlock

CalculateBlock
  = "[" Calculate "]"
  / "{" Calculate "}"
  / "(" Calculate ")"
  / number
  / identifier
  / Expand
  / Get

Expand
  = (identifier / dictionary / list / string) "~"
  / StringTypeExpand

StringTypeExpand
  = stringType "~"
  / string "~"

Get
  = dictionary (_ "'" _ (identifier / string / StringTypeExpand))*
  / list ( _ "'" _ (number / identifier / Sequence))
  / (identifier / string / StringTypeExpand) __ "@" __ Get
  / Address

Address
  = address
  / "$"? Input

Input = "@"? Compute

Compute = BitShift

BitShift = BitOr (_ ("<<" / ">>") _ BitOr)*
BitOr = BitXor (_ "||" _ BitXor)*
BitXor = BitAnd (_ ";;" _ BitAnd)*
BitAnd = BitNot (_ "&&" _ BitNot)*
BitNot = "!!"? (address / register)

Import = (identifier / string / StringTypeExpand) "@"

Block
  = "[" Verification "]"
  / "{" Verification "}"
  / "(" Verification ")"
  / Indent Verification Dedent
  / Atom

Atom
  = charactor
  / number
  / address
  / register
  / unicode
  / function
  / dictionary
  / list
  / stringType
  / identifier
  / unit

// 1. 文字列型
// インデントされている、あるいは式の途中に現れるバッククォート囲みは文字列として確定します。

string = $("`" [^`\r\n]* "`")

charactor = $("\\" [\s\S])

// 2. 浮動小数点
// （整数部 . 小数部）
number = $("-"? int_part:[0-9]+ "."? frac_part:[0-9]*)

// 3. アドレス型 ("0x" Hex*)
// ※ AArch64のメモリオペランド等に直接写像される
address = $("0x" Hex+)

// 4. レジスタ即値型 ("0r" Hex*)
// ※ AArch64の物理レジスタ（x0, v0など）や直値バインディングに写像される
register 
  = $("0r" Hex+)
  / $("0b" ("0" / "1")+)

// 5. UniCode型 ("0u" Hex*)
unicode = $("0u" Hex+)

// 6. 識別子（変数名など）
identifier = $([a-zA-Z_][a-zA-Z0-9_]*)

function
  = name:identifier &{ return typeTable[name] === "function"; }

dictionary
  = name:identifier &{ return typeTable[name] && typeTable[name].constructor === Object; }

list
  = name:identifier &{ return Array.isArray(typeTable[name]); }

stringType
  = name:identifier &{ return typeTable[name] === "string"; }

Hex = [0-9a-fA-F]

prefix
  = "###" / "##" / "#" / "~" / "!!" / "!" / "$" / "@"

postfix
  = "!" / "~" / "@"

infix
  = "~+" / "~-" / "~*" / "~/" / "~^"
  / "<<" / ">>" / "||" / ";;" / "&&"
  / "<=" / "==" / ">=" / "!="
  / ":" / "#" / "?" / "," / "~" / ";" / "|" / "&"
  / "<" / "=" / ">" / "+" / "-" / "*" / "/" / "%" / "^" / "@" / "'"

unit = "_"

Indent = tab:[\t]+ &{
// 現在のインデントレベル（スタックのトップ）を取得
  const currentIndentLength = context.indentStack.length > 0 
    ? context.indentStack[context.indentStack.length - 1] 
    : 0;
  
  // 読み込んだタブの数が現在のインデントより深いかチェック
  if (tab.length > currentIndentLength) {
    context.indentStack.push(tab.length);
    context.indent = tab.join("");
    return true; // マッチ成功
  }
  return false; // マッチ失敗（インデントされていない）
}

Dedent = &{
// 実際には文字を消費せず（&述語）、インデントが浅くなったことを検知するロジック
  // 次の行のタブ数を先読みして、スタックをpopするような処理が必要になります。
  
  // ※ ここは少し工夫が必要で、通常は行頭のパース時に先読み (lookahead) して、
  // 現在のスタックトップよりもタブが少なければ pop しつつマッチ成功とする、という形にします。
  
  // とりあえず pop するだけのプレースホルダー
  if (context.indentStack.length > 0) {
     context.indentStack.pop();
     const newLen = context.indentStack.length > 0 
        ? context.indentStack[context.indentStack.length - 1] 
        : 0;
     context.indent = "\t".repeat(newLen);
     return true;
  }
  return false;
}
