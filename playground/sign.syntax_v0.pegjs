{
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

Program = (SOL Expression EOL)*

Expression
  = Comment
  / Export

Comment = ("`" [^\r\n]*) {return ""}

Export = ("###" / "##" / "#")? Define

Define
  = identifier _ ":" _ Define
  / Lambda

Lambda
  = Arguments _ "?" _ Lambda
  / Arguments _ "?" Match_Case+
  / PointFree
  / Output
  / Construct

Output
  = (address / identifier) (__ "#" __ Lambda)+
  / Construct

Construct
  = Dictionary
  / Product
  / Sequence
  / Coproduct

Dictionary = Indent ((identifier "~"? / string) _ ":" _ (Lambda / Atom / Construct))+ Dedent

Arguments = Inline / Defaultive


Defaultive
  = "[" EOL Indent ("~"? identifier (_ ":" _ Lambda EOL)?)* Dedent "]"
  / "{" EOL Indent ("~"? identifier (_ ":" _ Lambda EOL)?)* Dedent "}"
  / "(" EOL Indent ("~"? identifier (_ ":" _ Lambda EOL)?)* Dedent ")"

Inline
  = identifier (__ "~"? identifier)*

Match_Case = Indent (Calculate ":" (Calculate / Dictionary / Lambda))+ Dedent
 
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

DirectFold = infix

Product
  = Coproduct (_ "," _ Product)
  / Sequence

Coproduct = (Sequence / Calculate) (__ (Sequence / Calculate))*

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

Calculate = Logical_Xor
Logical_Xor = Logical_Or (_ ";" _ Logical_Or)*
Logical_Or = Logical_And (__ "|" __ Logical_And)*
Logical_And = Compare (_ "&" _ Compare)*

Compare = Arithmetic (_ ("<" / "<=" / "=" / "==" /">=" / ">" / "!=") _ Arithmetic)*

Arithmetic = Additive

Additive = Multiply (_ ("+" / __ "-" __) _ Multiply)*
Multiply = Expornential (_ ("*" / "/" / "%") _ Expornential)*

Expornential
  = Absolute _ "^" _ Expornential
  / Absolute

Absolute
  = "|" (Additive / CalculateBlock) "|"
  / CalculateBlock

CalculateBlock
  = "[" Coproduct "]"
  / "{" Coproduct "}"
  / "(" Coproduct ")"
  / Get

Get
  = (identifier / Dictionary) (_ "'" _ (identifier "~"? / string))*
  / identifier ( _ "'" _ (Product / Sequence / number / identifier))*
  / (identifier "~"? / string) __ "@" __ Get
  / Compute

Compute = BitShift

BitShift = BitOr (_ ("<<" / ">>") _ BitOr)*
BitOr = BitXor (_ "||" _ BitXor)*
BitXor = BitAnd (_ ";;" _ BitAnd)*
BitAnd = BitNot (_ "&&" _ BitNot)*
BitNot = "!!"? (address / register)

Prefix
  = prefix* Postfix

Postfix
  = Block postfix*

Block
  = "[" Expression* "]"
  / "{" Expression* "}"
  / "(" Expression* ")"
  / Indent Expression* Dedent
  / Atom

Atom
  = charactor
  / number
  / address
  / register
  / unicode
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
