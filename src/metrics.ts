import express from 'express';
import * as promClient from 'prom-client';

promClient.collectDefaultMetrics();

const requestsInFlight = new promClient.Gauge({
    name: 'http_server_requests_in_flight',
    help: 'Gague for requests currently being processed',
    labelNames: ['method'],
});

const requestsTotalCounter = new promClient.Counter({
    name: 'http_server_requests_total',
    help: 'Counter for total requests',
    labelNames: ['method', 'code', 'uri'],
});

const requestDuration = new promClient.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'duration histogram of http responses',
    labelNames: ['method', 'uri'],
    buckets: [0.003, 0.01, 0.05, 0.1, 0.3, 1.0, 2.5, 10],
});

const signalHealthCheckCounter = new promClient.Counter({
    name: 'signal_health_check',
    help: 'number of times the health check has been called',
});

const signalHealthCheckUnhealthyCounter = new promClient.Counter({
    name: 'signal_unhealthy_check',
    help: 'number of times the health check has been called and returned unhealthy',
});

const signalHealthTotalUnhealthyCounter = new promClient.Counter({
    name: 'signal_unhealthy_total',
    help: 'number of times gone unhealthy',
});

const signalHealthGauge = new promClient.Gauge({
    name: 'signal_health',
    help: 'gauge for signal health (1) or unhealthy (0)',
});

const signalCensusGauge = new promClient.Gauge({
    name: 'signal_census',
    help: 'gauge for census health (1) or unhealthy (0)',
});

const prosodySumSquaredParticipantsGauge = new promClient.Gauge({
    name: 'prosody_participant_sum_squared',
    help: 'gauge for participant sum squared gauge',
});

export function middleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const start = process.hrtime();
    const method = req.method.toLowerCase();
    requestsInFlight.inc({ method });

    let statted = false;
    const stat = () => {
        if (!statted) {
            statted = true;
            const delta = process.hrtime(start);
            let uri = 'unknown';
            if (req.originalUrl) {
                uri = req.originalUrl.replace(':', '');
            }
            requestDuration.observe({ method, uri }, delta[0] + delta[1] / 1e9);

            const code = res.statusCode;
            requestsTotalCounter.inc({ method, code, uri });
            requestsInFlight.dec({ method });
        }
    };
    // Fire stat on both finish and close to ensure that stat is
    // emitted even if http client cancels before response.
    res.on('finish', stat);
    res.on('close', stat);
    next();
}

export function registerHandler(app: express.Express, path: string): void {
    app.get(path, async (req: express.Request, res: express.Response) => {
        try {
            res.set('Content-Type', promClient.register.contentType);
            res.end(promClient.register.metrics());
        } catch (err) {
            res.status(500).end(err);
        }
    });
}

export default {
    RequestsInFlight: requestsInFlight,
    RequestsTotalCounter: requestsTotalCounter,
    RequestDuration: requestDuration,
    SignalHealthCheckCounter: signalHealthCheckCounter,
    SignalHealthCheckUnhealthyCounter: signalHealthCheckUnhealthyCounter,
    SignalHealthTotalUnhealthyCounter: signalHealthTotalUnhealthyCounter,
    SignalHealthGauge: signalHealthGauge,
    SignalCensusGauge: signalCensusGauge,
    ProsodySumSquaredParticipantsGauge: prosodySumSquaredParticipantsGauge,
    middleware: middleware,
    registerHandler: registerHandler,
};
