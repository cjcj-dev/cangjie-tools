// Supplementary same-package checks; public cjpm coverage is in diagnostics.mjs.
package cjpm.toml

func require(value: Bool, message: String) {
    if (!value) { throw Exception(message) }
}

func compareErrors(text: String) {
    let plain = Lexer(text.toArray())
    let bom = Lexer(("\u{FEFF}" + text).toArray(), 3)
    while (true) {
        let a = plain.nextItem()
        let b = bom.nextItem()
        require(a.typ == b.typ, "token kinds must match")
        require(a.pos.line == b.pos.line, "line must match")
        require(a.pos.start == b.pos.start, "BOM normalized byte offset must match")
        require(a.pos.len == b.pos.len, "byte length must match")
        if (a.typ == ITEMTYPE.ERROR) {
            println("ERROR_OFFSET ${a.pos}")
            return
        }
        require(a.typ != ITEMTYPE.EOF, "invalid input must reach error")
    }
}

main(): Int64 {
    let plain = parse("label = \"é\"\nvalue = 7\n")
    let bom = parse(("\u{FEFF}label = \"é\"\nvalue = 7\n").toArray())
    require(bom.lex.contentOffset == 3, "byte parser must skip BOM in original array")
    require(plain.lex.contentOffset == 0, "ordinary parser offset")
    for ((key, info) in plain.keyInfo) {
        let other = bom.keyInfo[key]
        require(info.pos.line == other.pos.line && info.pos.start == other.pos.start && info.pos.len == other.pos.len,
            "parser key positions must match")
    }
    compareErrors("label = \"é\"\nprobe = @\n")
    compareErrors("label = { value = 1\n}\n")
    compareErrors("label = \"bad\n")
    println("PASS byte parser and lexer offsets")
    return 0
}
