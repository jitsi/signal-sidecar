# signal-sidecar
sidecar that reports detailed health information from a jitsi signal node

## endpoints

* `/health` responds with 200 if this sidecar is reachable
* `/signal/report` responds with 200 if the signal node is healthy and 500 if not

## configuration

* `HTTP_PORT`: port for REST calls [6000]
* `HA_PORT`: TCP port for HAProxy TCP mode [6060] `[TO BE IMPLEMENTED]`
* `LOG_LEVEL`: debug, info, warn, or error [info]
* `JICOFO_ORIG`: origin for jicofo [http://localhost:8888]
* `PROSODY_ORIG`: origin for prosody [http://localhost:5280]
* `STATUS_PATH`: file for ready/drain status [/etc/jitsi/shard-status]
* `POLLING_INTERVAL`: number of seconds between polls [5]
* `PARTIPANT_MAX`: max number of participants before node should be drained [5000]

## /signal/report response json

```
{
    "healthy": [boolean],                              // overall signal node health
    "status": [ready|drain|unknown],                   // drain state of node
    "services": {
        "jicofoReachable": [boolean]                   // jicofo health http reachable
        "jicofoStatusCode": [http status or 0],        // http code from jicofo
        "jicofoStatsReachable": [boolean]              // jicofo health http reachable
        "jicofoStatusStatusCode": [http status or 0],  // http code from jicofo
        "prosodyReachable": [boolean],                 // prosody health http reachable
        "prosodyStatusCode": [http status code or 0],  // http code from prosody
        "statusFileFound": [boolean],                  // was the status file found
        "statusFileContents": [stuff],                 // contents of the status file
    },
    "stats": {
        "jicofoParticipants": [number]                 // number of jicofo participants
        "jicofoConferences": [number]                  // number of jicofo conferences
    }
}
```
## debian build command

> dpkg-buildpackage -A -rfakeroot -us -uc
