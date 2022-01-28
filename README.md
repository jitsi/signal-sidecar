# signal-sidecar
a sidecar that reports detailed health information from a jitsi signal node.

## overview
`signal-sidecar` collects data from a Jitsi signal node and presents it in
for consumption by devops tools that manage a Jitsi deployment. It offers
several REST endpoints with health, metadata, and metrics, and also runs a
HAProxy TCP agent.

Reported drain status is normally based on the contents of a file located at
`STATUS_PATH`. The sidecar will report a `DRAIN` status anytime the number of
`jicofo` participants exceeds `PARTICIPANT_MAX`.

The HAProxy agent can optionally send a weight back that is a function of
current `jicofo` participants vs. `PARTICIPANT_MAX`.

`signal-sidecar` is capable of querying the `mod_muc_census` Jitsi Meet Prosody
plugin and reporting room census data as well.

## REST endpoints

* `/health` responds with 200 if this sidecar itself is reachable
* `/signal/health` empty response; code 200 = healthy, 500/503 = broken/unhealthy
* `/signal/report` json report; code 200 = healthy, 500/503 = broken/unhealthy
* `/signal/census` census of the signal node (optional; requires `mod_muc_census` on `prosody`)
* `/metrics` prometheus metrics (optional)

## configuration

* `HTTP_PORT`: port for REST calls [6000]
* `TCP_PORT`: TCP port for HAProxy TCP agent [6060]
* `JICOFO_ORIG`: origin for jicofo [http://localhost:8888]
* `PROSODY_ORIG`: origin for prosody [http://localhost:5280]
* `STATUS_PATH`: file for ready/drain/maint status [/etc/jitsi/shard-status]
* `POLLING_INTERVAL`: number of seconds between polls [5]
* `PARTIPANT_MAX`: report node in drain state with > this # participants [5000]
* `WEIGHT_PARTICIPANTS`: send weight via TCP agent based on `PARTICIPANT_MAX` [false]
* `CENSUS_POLL`: boolean indicating whether to poll census [false]
* `CENSUS_HOST`: conference host name for census
* `METRICS`: boolean indicating whether to publish prometheus metrics [true]
* `LOG_LEVEL`: debug, info, warn, or error [info]

## /signal/report response json

```
{
    "healthy": [boolean],                              // overall signal node health
    "status": [ready|drain|maint|unknown],             // drain state of node
    "weight": [string],                                // weight of node (0-100%)
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

When `WEIGHT_PARTICIPANTS` is not `true`, `weight` will be `0%` if the status
is `drain` or `maint`, and `100%` otherwise. When it is `true` it will return
a percentage based on `jicofoParticipants` vs. `PARTICIPANT_MAX`, and `0%` if
`jicofo` stats are broken. 


## development builds

The current version has been tested with node v12.22 and npm v6.14.

Before making a submission, please run the following so that it's linted properly:
> npm install
> npn run build

## debian build command

> dpkg-buildpackage -A -rfakeroot -us -uc
