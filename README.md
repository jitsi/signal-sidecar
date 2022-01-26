# signal-sidecar
a sidecar that reports detailed health information from a jitsi signal node.

## overview
`signal-sidecar` collects data from `jicofo` and `prosody` and presents it in a
format intended for consumption by devops tools that manage a Jitsi deployment. 

Reported drain status is normally based on the contents of a file located at
`STATUS_PATH`. The sidecar will report a `DRAIN` status anytime the number of
`jicofo` participants exceeds `PARTICIPANT_MAX`.

`signal-sidecar` is capable of querying the `mod_muc_census` Jitsi Meet Prosody
plugin and reporting room census data as well.

## endpoints

* `/health` responds with 200 if this sidecar is reachable
* `/signal/report` json report; code 200 = healthy, 500/503 = broken/unhealthy
* `/signal/census` responds with signal node room census (optional; requires `mod_muc_census`)

## configuration

* `HTTP_PORT`: port for REST calls [6000]
* `TCP_PORT`: TCP port for HAProxy TCP agent [6060]
* `JICOFO_ORIG`: origin for jicofo [http://localhost:8888]
* `PROSODY_ORIG`: origin for prosody [http://localhost:5280]
* `STATUS_PATH`: file for ready/drain/maint status [/etc/jitsi/shard-status]
* `POLLING_INTERVAL`: number of seconds between polls [5]
* `PARTIPANT_MAX`: report node in drain state with > this # participants [5000]
* `CENSUS_POLL`: boolean indicating whether to poll census [false]
* `CENSUS_HOST`: conference host name for census
* `METRICS`: boolean indicating whether to publish prometheus metrics [true]
* `LOG_LEVEL`: debug, info, warn, or error [info]

## /signal/report response json

```
{
    "healthy": [boolean],                              // overall signal node health
    "status": [ready|drain|maint|unknown],             // drain state of node
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
