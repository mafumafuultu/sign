// ==========================================
// Sign Language Syntax (v1 Pre-Static Analysis)
// Based on current parser_browser.js precedence
// ==========================================

Program
  = Block

// ------------------------------------------
// Blocks and Groups
// ------------------------------------------
Block
  = Statement ( ( "\n" / "," ) Statement )*

Statement
  = Expr

Group
  = "(" Expr ")"
  / "[" Block "]"
  / "{" Block "}"

Atom
  = Number
  / String
  / Identifier
  / Group

// ------------------------------------------
// Precedence Levels (Lower number = looser binding)
// ------------------------------------------

// Base expression entry point
Expr = Level1

// Level 1: Export Modifiers (Prefix)
Level1
  = op:("#" / "##" / "###") expr:Level1
  / Level2

// Level 2: Assignment / Type Assertion (Infix, Right-Associative)
Level2
  = lhs:Level3 op:":" rhs:Level2
  / Level3

// Level 3: Export Infix (Infix, Left-Associative)
Level3
  = head:Level4 tail:( "#" rhs:Level4 )*

// Level 4: Function Application (Juxtaposition / Space, Left-Associative)
// (Implementation often handles this specially, represented here as adjacent expressions)
Level4
  = head:Level5 tail:( rhs:Level5 )*

// Level 5: Lambda / Function Declaration (Infix, Right-Associative)
Level5
  = lhs:Level6 op:"?" rhs:Level5
  / Level6

// Level 6: Comma Sequence (Infix, Right-Associative)
Level6
  = lhs:Level9 op:"," rhs:Level6
  / Level9

// Level 9: Range Generators (Infix, Left-Associative)
Level9
  = head:Level10 tail:( ( "~+" / "~-" / "~*" / "~/" / "~^" / "~" ) rhs:Level10 )*

// Level 10: Continuous Operator (Prefix)
Level10
  = "~" expr:Level10
  / Level11

// Level 11: Logic XOR (Infix, Left-Associative)
Level11
  = head:Level12 tail:( ";" rhs:Level12 )*

// Level 12: Logic OR (Infix, Left-Associative)
Level12
  = head:Level13 tail:( "|" rhs:Level13 )*

// Level 13: Logic AND (Infix, Left-Associative)
Level13
  = head:Level14 tail:( "&" rhs:Level14 )*

// Level 14: Logic NOT (Prefix)
Level14
  = "!" expr:Level14
  / Level15

// Level 15: Comparison (Infix, Left-Associative)
Level15
  = head:Level16 tail:( ( "<=" / ">=" / "==" / "!=" / "<" / ">" / "=" ) rhs:Level16 )*

// Level 16: Addition & Subtraction (Infix, Left-Associative)
Level16
  = head:Level17 tail:( ( "+" / "-" ) rhs:Level17 )*

// Level 17: Multiplication, Division, Modulo (Infix, Left-Associative)
Level17
  = head:Level18 tail:( ( "*" / "/" / "%" ) rhs:Level18 )*

// Level 18: Power (Infix, Right-Associative)
Level18
  = lhs:Level19 op:"^" rhs:Level18
  / Level19

// Level 19: Factorial (Postfix)
Level19
  = expr:Level21 op:"!"
  / Level21

// Level 21: Expand / Spread (Postfix)
Level21
  = expr:Level22 op:"~"
  / Level22

// Level 22: Property Get (Infix, Left-Associative)
Level22
  = head:Level23 tail:( "'" rhs:Level23 )*

// Level 23: Direct Address Access / At (Infix, Left-Associative)
Level23
  = head:Level24 tail:( "@" rhs:Level24 )*

// Level 24: Address (Ref) & Input (Prefix)
Level24
  = ( "$" / "@" ) expr:Level24
  / Level25

// Level 25: Bitwise Shift (Infix, Left-Associative)
Level25
  = head:Level26 tail:( ( "<<" / ">>" ) rhs:Level26 )*

// Level 26: Bitwise OR (Infix, Left-Associative)
Level26
  = head:Level27 tail:( "||" rhs:Level27 )*

// Level 27: Bitwise XOR (Infix, Left-Associative)
Level27
  = head:Level28 tail:( ";;" rhs:Level28 )*

// Level 28: Bitwise AND (Infix, Left-Associative)
Level28
  = head:Level29 tail:( "&&" rhs:Level29 )*

// Level 29: Bitwise NOT (Prefix)
Level29
  = "!!" expr:Level29
  / Level30

// Level 30: Module Import (Postfix)
Level30
  = expr:Level33 op:"@"
  / Level33

// Level 33: Escape (Prefix)
Level33
  = "\\" expr:Level33
  / Atom

// ------------------------------------------
// Lexical Tokens
// ------------------------------------------
Number
  = [0-9]+ ("." [0-9]+)?

String
  = "\"" [^"]* "\""
  / "'" [^']* "'"
  / "\`" [^\`]* "\`"

Identifier
  = [a-zA-Z_] [a-zA-Z0-9_]*
