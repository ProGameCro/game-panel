#
# BigBrotherBot(B3) (www.bigbrotherbot.net)
#
# CoD4X 1.8 parser for servers WITHOUT the b3hide plugin.
# It is the cod4x parser, but it reads the players from the server's own "status" command instead of "b3status".
# CoD4X 1.8 prints the playerid (the same number the game log uses as GUID) and the steamid in that list.
# Use it with:  <set name="parser">cod4x18</set>
# (needs sv_usesteam64id 1, which is the CoD4X default, so the playerid is printed as a number)

__author__ = 'OVHcloud Game Panel'
__version__ = '1.0'

import re
import b3.parsers.cod4x


class Cod4X18Parser(b3.parsers.cod4x.Cod4XParser):

    # num score ping playerid            steamid           name                             lastmsg address    qport rate
    #   2     0   48 1234567890123456789 76561198000000000 Player^7                                  0 1.2.3.4:28960 12345 25000
    _regPlayer = re.compile(r'^\s*(?P<slot>[0-9]+)\s+'
                            r'(?P<score>-?[0-9]+)\s+'
                            r'(?P<ping>[0-9]+)\s+'
                            r'(?P<guid>[0-9]+)\s+'
                            r'(?P<steamid>\S+)\s+'
                            r'(?P<name>.*?)\s+'
                            r'(?P<last>[0-9]+)\s+'
                            r'(?P<ip>(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}'
                            r'(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])):'
                            r'(?P<port>-?[0-9]{1,5})\s+'
                            r'(?P<qport>-?[0-9]{1,5})\s+'
                            r'(?P<rate>[0-9]+)$', re.IGNORECASE)
    _regPlayerShort = _regPlayer
    _reMapNameFromStatus = re.compile(r'^map\s*:\s*(?P<map>\S+)', re.IGNORECASE)

    def write(self, msg, maxRetries=None, socketTimeout=None):
        # the cod4x parser asks for "b3status" (b3hide plugin); CoD4X's own command is "status"
        if msg == 'b3status':
            msg = 'status'
        return b3.parsers.cod4x.Cod4XParser.write(self, msg, maxRetries=maxRetries, socketTimeout=socketTimeout)

    def getMap(self):
        """
        Return the current map/level name ("map     : mp_crash" line of CoD4X's status).
        """
        data = self.write('status')
        if not data:
            return None
        for line in data.split('\n'):
            m = re.match(self._reMapNameFromStatus, line.strip())
            if m:
                return str(m.group('map'))
        return None
