# BigBrotherBot for the OVHcloud Game Panel: the user's B3 (B3 1.12 with the cod4x parser, Python 2.7),
# built from big-brother-bot-master.zip; b3-complete-ebc.sql is the complete database schema (fixed copy)
FROM python:2.7-slim
COPY b3src /opt/b3
COPY b3-complete-ebc.sql /opt/b3/b3/sql/mysql/b3-complete-ebc.sql
# cod4x18: the cod4x parser for CoD4X servers without the b3hide plugin (reads players from "status")
COPY cod4x18.py /opt/b3/b3/parsers/cod4x18.py
RUN find /opt/b3 -name '*.pyc' -delete \
 && pip install --no-cache-dir -q --disable-pip-version-check -r /opt/b3/requirements.txt \
 && chmod -R a+rwX /opt/b3/b3/parsers /opt/b3/b3/extplugins
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENV PYTHONUNBUFFERED=1 HOME=/data/b3 USER=b3 LOGNAME=b3 TERM=dumb
WORKDIR /opt/b3
ENTRYPOINT ["/entrypoint.sh"]
