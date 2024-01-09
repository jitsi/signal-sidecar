# jitsi/signal-sidecar
a sidecar that reports detailed health information from a jitsi signal node.

## overview
**signal-sidecar** collects and aggregates data from a Jitsi signal node for
easy consumption by infra tooling. It offers REST endpoints with health,
metadata, and metrics. It also provides a HAProxy TCP agent for HAProxy
agent-check health checks which allows HAProxy to intelligently balance between
Jitsi signal nodes.

Reported drain status is normally based on the contents of a file located at
`STATUS_PATH`. The sidecar will also report `DRAIN` status in some cases where
there is a malfunction.

The HAProxy agent can, using the `WEIGHT_PARTICIPANTS` flag, send a weight back
via the TCP agent that is a function of current **jicofo** participants vs.
`PARTICIPANT_MAX`. This will never go below 1%.

**signal-sidecar** is capable of querying the
[mod_muc_census jitsi-meet prosody plugin](https://github.com/jitsi/jitsi-meet/blob/master/resources/prosody-plugins/mod_muc_census.lua)
to report room census data.

## running

build locally with:
```
> npm install
> npn run build
```

* Copy the contents of ./dist to somewhere.
* Set any environment variables that are relevant to your configuration (see below).
* Run with `node <dist>/app.js` 

An official public debian package will be coming to https://ci.jitsi.org soon. Until then, you can roll your own with:
```
> dpkg-buildpackage -A -rfakeroot -us -uc
```

### configuration

The following environment variables can be configured. If using the package,
they can be set in `/etc/jitsi/signal-sidecar/config`

* `HTTP_PORT`: port for REST calls [6000]
* `TCP_PORT`: TCP port for HAProxy TCP agent [6060]
* `JICOFO_ORIG`: origin for **jicofo** [http://localhost:8888]
* `PROSODY_ORIG`: origin for prosody [http://localhost:5280]
* `STATUS_PATH`: file for ready/drain/maint status [/etc/jitsi/shard-status]
* `POLLING_INTERVAL`: number of seconds between polls [5]
* `PARTIPANT_MAX`: report node in drain state with > this # participants [5000]
* `WEIGHT_PARTICIPANTS`: send weight via TCP agent based on `PARTICIPANT_MAX` [false]
* `CENSUS_POLL`: boolean indicating whether to poll census [false]
* `CENSUS_HOST`: conference host name for census
* `HEALTH_DAMPENING_INTERVAL`: seconds to wait before report can go healthy [30]
* `DRAIN_GRACE_INTERVAL`: seconds for tcp agent to report drain instead of down [120]
* `METRICS`: boolean indicating whether to publish prometheus metrics [true]
* `LOG_LEVEL`: debug, info, warn, or error [info]

Set the contents of the file at `STATUS_PATH` to `ready` or `drain` depending on
what you want **signal-sidecar** to report. It can also be set to `unhealthy`
for testing purposes, which will force **signal-sidecar** to always report
unhealthy.

### flap prevention configuration

**signal-sidecar** provides two types of flap mitigation:

* `HEALTH_DAMPENING_INTERVAL` can be used to prevent the REST endpoint from
  responding with healthy immediately after the signal node is healthy. This can
  be useful for the case where a system is under heavy load and jicofo or
  prosody are going into and out of healthy states. **signal-sidecar** will
  report that it is healthy after the last time a component was detected as
  being unhealthy plus this interval. Defaults to 30 seconds.

* `DRAIN_GRACE_INTERVAL` is used to cause the HAProxy TCP agent to back off from
  marking itself as DOWN immediately upon detecting jicofo as unhealthy. This gives
  jicofo a chance to recover from load spikes if prosody continues to function.
  **signal-sidecar** will report DRAIN to the HAProxy from the time that jicofo
  initially went unhealthy and only begin reporting DOWN after this interval has
  passed. This must be set higher than `HEALTH_DAMPENING_INTERVAL`, and if it is
  not, it will be forced higher. Defaults to 2 minutes.

These are enabled by default and can be disabled by setting them to 0.

## REST endpoints

**signal** sidecar is intended to be a single destination for health checks for
a signal node. To configure a HTTP health check to determine the health of the
complete signal node, point the health checker at the `/signal/health` endpoint.

* `/health` responds with 200 if this sidecar itself is reachable
* `/signal/health` empty response; code 200 = healthy, 500/503 = broken/unhealthy
* `/signal/report` json report; code 200 = healthy, 500/503 = broken/unhealthy
* `/signal/census` census of the signal node (optional; requires `mod_muc_census` on `prosody`)
* `/metrics` prometheus metrics (optional)

### /signal/report response json

```
{
    "time": [string],
    "healthy": [boolean],                          // overall signal node health
    "status": [ready|drain|maint|unknown],         // drain state of node including flap mitigation
    "weight": [string],                            // weight of node (0-100%)
    "agentmessage" [string],                       // current tcp agent message
    "services": {
        "jicofoHealthy": [boolean],                // jicofo generally healthy
        "jicofoReachable": [boolean],              // jicofo health http reachable
        "jicofoStatusCode": [http status or 0],    // http code from jicofo
        "jicofoStatusContents": [string],          // contents of jicofo status call
        "jicofoStatsReachable": [boolean],         // jicofo health http reachable
        "jicofoStatusStatusCode": [status or 0],   // http status code from jicofo
        "prosodyHealthy": [boolean],               // prosody generally healthy
        "prosodyReachable": [boolean],             // prosody health http reachable
        "prosodyStatusCode": [status code or 0],   // http status code from prosody
    },
    "statuses": {
        "statusFileFound": [boolean],              // was the status file found
        "statusFileContents": [stuff],             // contents of the status file
    },
    "stats": {
        "jicofoParticipants": [number],             // number of jicofo participants
        "jicofoConferences": [number],              // number of jicofo conferences
        "prosodyParticipants": [number],            // prosody participants; requires `CENSUS_POLL`
        "prosodySumSquaredParticipants": [number],  // sum participants^2 per conference; req `CENSUS_POLL`
    }
}
```

When `WEIGHT_PARTICIPANTS` is not **true**, `weight` will be `0%` if the status
is `drain` or `maint`, and `100%` otherwise. When **true**, it will return
an integer percentage divisible by 5 based on `jicofoParticipants` vs.
`PARTICIPANT_MAX`, and `0%` if **jicofo** stats are broken. 

## HAProxy TCP agent use

To use the TCP agent for a HAProxy server, the config should look something like:

```
backend my_backend
  server server_name 10.0.0.10:443 ssl verify required agent-check agent-port 6060 agent-inter 2s weight 256
```

This will have HAProxy query the **signal-sidecar** agent every 2s. The server
will be given a default weight of 256, which will be reduced based on the %
that's returned by the TCP agent.

## development builds

The current version has been tested with node v16.18.1 and npm v8.19.2

Before making a submission, please run the following so that it's linted properly:
```
> npm install
> npn run build
```
