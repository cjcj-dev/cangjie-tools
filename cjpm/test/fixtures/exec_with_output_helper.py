#!/usr/bin/env python3

import os
import sys


def main() -> int:
    stderr_bytes = int(sys.argv[1])
    os.write(1, b"OUT-0001\n")
    os.write(2, b"E" * stderr_bytes)
    os.write(1, b"OUT-0002\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
