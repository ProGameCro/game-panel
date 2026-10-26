#!/bin/bash
# LinuxGSM check_gamedig.sh module, replaced by the Game Panel (gp-cod4-linux.sh).
# The original fetched package.json from GitHub and ran npm at every start, which slowed every start down.
# Without Gamedig, LinuxGSM queries the server itself (gsquery), which works for Call of Duty 4.

moduleselfname="$(basename "$(readlink -f "${BASH_SOURCE[0]}")")"
