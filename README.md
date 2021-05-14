# signal-sidecar
sidecar that reports detailed health information from a jitsi signal node

## configuration

* `HTTP_PORT`: port for REST calls [6000]
* `HA_PORT`: TCP port for HAProxy TCP mode [6060]
* `LOG_LEVEL`: debug, info, warn, or error [info]
* `JICOFO_URL`: endpoint for jicofo health
* `PROSODY_URL`: endpoint for prosody health
* `STATUS_PATH`: file for ready/drain status
* `POLLING_INTERVAL`: number of seconds between polls [30]



## response json

```
{
    "health": [UP|DOWN],                          // overall signal node health
    "status": [READY|DRAIN|UNKNOWN],              // drain state of node
    "services": {
        "jicofo_http": [boolean]                  // jicofo health http reachable
        "jicofo_code": [http status code or 0],   // http code from jicofo
        "prosody_http": [boolean],                // prosody health http reachable
        "prosody_code": [http status code or 0],  // http code from prosody
        "status_file": [boolean],                 // was the status file found
        "status_file"contents: [stuff],           // contents of the status file
    },
}
```
