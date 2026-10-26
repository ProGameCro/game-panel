#!/bin/bash
# LinuxGSM command_sponsor.sh module, replaced by the Game Panel (gp-cod4-linux.sh): no sponsor banner.

commandname="SPONSOR"
commandaction="Sponsor"
moduleselfname="$(basename "$(readlink -f "${BASH_SOURCE[0]}")")"
fn_firstcommand_set

core_exit.sh
