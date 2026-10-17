// Supplementary same-package check; public diagnostics are verified separately.
package cjpm.implement
import std.collection.*
import cjpm.config.*
main(): Int64 {
    let model = DepModel(GlobalConfig())
    let importers = ArrayList<String>(["consumer.z", "consumer.a"])
    model.edges["absent.shared"] = importers
    if (lackPackageCheck(model)) { throw Exception("missing dependency must be rejected") }
    if (importers[0] != "consumer.z" || importers[1] != "consumer.a") {
        throw Exception("diagnostic must not mutate original importer order")
    }
    println("PASS importer state preserved")
    return 0
}
