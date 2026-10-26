# Local image for Call of Duty 4 servers (gamepanel-local/cod4), built by gp-cod4-linux.sh.
# The LinuxGSM image already has linuxgsm.sh and all modules; this adds what LinuxGSM would otherwise fetch from
# GitHub when a container starts: the cod4server script (made from linuxgsm.sh, like "./linuxgsm.sh cod4server"),
# its default config, and linuxgsm.sh in lgsm/tmp. check_gamedig.sh no longer runs npm and GitHub at every start.
# No LinuxGSM advertising in the server log: no sponsor banner, no GitHub lines, no ismygameserver.online link.
ARG BASE=gameservermanagers/gameserver:cod4
FROM ${BASE}
COPY _default.cfg /app/lgsm/config-default/config-lgsm/cod4server/_default.cfg
COPY check_gamedig.sh command_sponsor.sh /app/lgsm/modules/
RUN sed -e 's/shortname="core"/shortname="cod4"/' -e 's/gameservername="core"/gameservername="cod4server"/' /app/linuxgsm.sh > /app/cod4server \
 && mkdir -p /app/lgsm/tmp && cp -p /app/linuxgsm.sh /app/lgsm/tmp/linuxgsm.sh \
 && sed -i 's|^\( *\)\./"${GAMESERVER}" sponsor$|\1true|; /# Sponsor to display LinuxGSM logo/d' /app/entrypoint-user.sh \
 && sed -i '/^echo -e "LGSM_GITHUB/d; s|^echo -e "Welcome to the LinuxGSM"$|echo -e "Call of Duty 4 server"|' /app/entrypoint.sh \
 && sed -i 's|^\([[:space:]]*\)echo -e "${lightblue}Query Check:.*$|\1:|' /app/lgsm/modules/info_messages.sh \
 && ! grep -q 'sponsor$' /app/entrypoint-user.sh && ! grep -q 'echo -e "LGSM_GITHUB' /app/entrypoint.sh \
 && ! grep -q 'Query Check' /app/lgsm/modules/info_messages.sh \
 && bash -n /app/entrypoint.sh && bash -n /app/entrypoint-user.sh && bash -n /app/lgsm/modules/info_messages.sh \
 && chmod 755 /app/cod4server /app/lgsm/modules/check_gamedig.sh /app/lgsm/modules/command_sponsor.sh \
 && chown -R linuxgsm:linuxgsm /app/cod4server /app/lgsm
