package probe
import std.collection.ArrayList

public class PlainControl {
    public func size(): Int64 {
        return ArrayList<Int64>().size
    }
}

main(): Int64 {
    return PlainControl().size()
}
