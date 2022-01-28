import config from './config';
import express from 'express';
import logger from './logger';
import HealthCollector from './health_collector';
import CensusCollector from './census_collector';
import metrics from './metrics';
import * as net from 'net';

logger.info('signal-sidecar startup', { config });

/////////////////////////
// health polling counter
let lastPollCheckTime: number = new Date().valueOf();
let currentPollCount = 0;
const pollCheckDurationSeconds = 3600;
const idealPollCount = pollCheckDurationSeconds / config.PollingInterval;
logger.info('initalizing health polling counter', {
    pollingDuration: pollCheckDurationSeconds,
    pollingTarget: idealPollCount,
});

function checkPollCounter() {
    const secondsElapsed: number = (new Date().valueOf() - lastPollCheckTime) / 1000;
    if (secondsElapsed > pollCheckDurationSeconds) {
        logger.info(
            `attempted ${currentPollCount} health checks in ${secondsElapsed} seconds; target is ${idealPollCount} checks every ${pollCheckDurationSeconds} seconds`,
            { report: healthReport },
        );
        lastPollCheckTime = new Date().valueOf();
        currentPollCount = 0;
    }
    currentPollCount++;
}

/////////////////////////
// health polling loop
const healthCollector = new HealthCollector({
    jicofoHealthUrl: config.JicofoOrig + '/about/health',
    jicofoStatsUrl: config.JicofoOrig + '/stats',
    prosodyHealthUrl: config.ProsodyOrig + '/http-bind',
    statusFilePath: config.StatusPath,
    participantMax: config.ParticipantMax,
    healthPollingInterval: config.PollingInterval,
    collectMetrics: config.Metrics,
});

const initHealthReport = healthCollector.initHealthReport();
let healthReport = initHealthReport;

let pollHealthy = true; // suppress state change log on restart

export function calculateWeight(nodeStatus: string, currentParticipants: number): string {
    if (nodeStatus === 'drain' || nodeStatus === 'maint') {
        return '0%';
    }

    if (!config.WeightParticipants) {
        // return 100% if weighting not configured
        return '100%';
    }

    if (currentParticipants === undefined) {
        logger.warn('weight set to 0% due to missing jicofoParticipants', { report: healthReport });
        return '0%';
    }

    // scales node weight based on current participants vs. maximum by increments of 5%, minimum of 10%
    const weight = Math.max(
        10,
        Math.round((100 - Math.floor(currentParticipants / config.ParticipantMax) * 100) / 5) * 5,
    );
    return `${weight}%`;
}

async function pollForHealth() {
    logger.debug('entering pollForHealth', { report: healthReport });
    checkPollCounter();
    try {
        healthReport = await healthCollector.updateHealthReport();
        if (!pollHealthy && healthReport.healthy) {
            logger.info('signal node state changed from unhealthy to healthy');
        } else if (pollHealthy && !healthReport.healthy) {
            logger.info('signal node state changed from healthy to unhealthy');
        }
        pollHealthy = healthReport.healthy;
    } catch (err) {
        logger.error('pollForHealth error', { err });
        healthReport = initHealthReport;
    }
    setTimeout(pollForHealth, config.PollingInterval * 1000);
}
pollForHealth();

/////////////////////////
// census polling loop
const censusCollector = new CensusCollector({
    prosodyCensusUrl: config.ProsodyOrig + '/room-census',
    censusHost: config.CensusHost,
    censusPollingInterval: config.PollingInterval,
    collectMetrics: config.Metrics,
});

const initCensusReport = censusCollector.initCensusReport();
let censusReport = initCensusReport;

async function pollForCensus() {
    logger.debug('entering pollForCensus', { report: censusReport });
    try {
        censusReport = await censusCollector.updateCensusReport();
    } catch (err) {
        logger.error('pollForCensus error', { err });
    }
    setTimeout(pollForCensus, config.PollingInterval * 1000);
}
if (config.CensusPoll) {
    pollForCensus();
}

////////////////////
// express handlers
const app = express();

async function healthReportHandler(req: express.Request, res: express.Response) {
    if (healthReport) {
        res.status(200);
        if (!healthReport.healthy) {
            logger.info('/signal/report returned 503', { report: healthReport });
            res.status(503);
        }
        res.send(JSON.stringify(healthReport));
    } else {
        logger.warn('/signal/health returned 500 due to no healthReport');
        res.sendStatus(500);
    }
}

async function signalHealthHandler(req: express.Request, res: express.Response) {
    if (config.Metrics) {
        metrics.SignalHealthCheckCounter.inc(1);
    }
    if (healthReport) {
        res.status(200);
        if (!healthReport.healthy) {
            logger.info('/health returned 503', { report: healthReport });
            if (config.Metrics) {
                metrics.SignalHealthCheckUnhealthyCounter.inc(1);
            }
            res.status(503);
            res.send('NOT_OK');
        } else {
            res.send('OK');
        }
    } else {
        logger.warn('/health returned 500 due to no healthReport');
        if (config.Metrics) {
            metrics.SignalHealthCheckUnhealthyCounter.inc(1);
        }
        res.status(500);
        res.send('NOT_OK');
    }
}

async function censusReportHandler(req: express.Request, res: express.Response) {
    if (censusReport) {
        res.status(200);
        res.send(JSON.stringify(censusReport));
    } else {
        logger.warn('/signal/census returned 500 due to no censusReport');
        res.sendStatus(500);
    }
}

/////////////////////////
// http endpoints
app.use(['/about*', '/signal*'], metrics.middleware);

// health of the signal-sidecar itself
app.get('/health', (req: express.Request, res: express.Response) => {
    res.sendStatus(200);
});

// overall health of signal node, intended to be a public endpoint
app.get(['/about/health', '/signal/health'], async (req, res, next) => {
    try {
        await signalHealthHandler(req, res);
    } catch (err) {
        next(err);
    }
});

// detailed health report intended for internal use for load balancing
app.get('/signal/report', async (req, res, next) => {
    try {
        await healthReportHandler(req, res);
    } catch (err) {
        next(err);
    }
});

// census of rooms in the signal node
if (config.CensusPoll) {
    app.get('/signal/census', async (req, res, next) => {
        try {
            await censusReportHandler(req, res);
        } catch (err) {
            next(err);
        }
    });
}

if (config.Metrics) {
    metrics.registerHandler(app, '/metrics');
}

app.listen(config.HTTPServerPort, () => {
    logger.info(`signal-sidecar http listener started on: ${config.HTTPServerPort}`);
});

/////////////////////////
// haproxy tcp agent listener
// ref: https://cbonte.github.io/haproxy-dconv/1.8/configuration.html#5.2-agent-check

const tcpServer = net.createServer();

tcpServer.on('error', (err) => {
    logger.error('tcp server error', { err });
});

// construct tcp agent response message
function tcpAgentMessage(): string {
    let message: string[] = [];
    if (config.Metrics) {
        metrics.SignalHealthCheckCounter.inc(1);
    }
    if (healthReport) {
        if (healthReport.healthy) {
            message.push('up');
        } else {
            message.push('down');
        }

        const nodeStatus = healthReport.status.toLowerCase();
        if (nodeStatus === 'ready' || nodeStatus === 'drain' || nodeStatus === 'maint') {
            message.push(nodeStatus);
        } else {
            message.push('drain');
            logger.warn(`tcp agent set drain due to an invalid status ${nodeStatus}`, { report: healthReport });
        }

        message.push(calculateWeight(nodeStatus, healthReport.stats.jicofoParticipants));
    } else {
        logger.warn('tcp agent returned down/drain due to missing healthReport');
        message = ['down', 'drain', '0%'];
    }
    if (config.Metrics && message.includes('down')) {
        metrics.SignalHealthCheckUnhealthyCounter.inc(1);
    }
    return message.join(' ');
}

// handle incoming TCP requests
tcpServer.on('connection', (sock) => {
    sock.on('error', (err) => {
        logger.error('tcp socket error', { err });
    });

    const agentReport = tcpAgentMessage();

    if (healthReport.healthy) {
        logger.debug(`${agentReport} reported to ${sock.remoteAddress}:${sock.remotePort}`);
    } else {
        logger.info(`${agentReport} reported to ${sock.remoteAddress}:${sock.remotePort}`);
    }
    sock.end(`${agentReport}\n`);
    sock.destroy();
});

tcpServer.listen(config.TCPServerPort, '0.0.0.0', () => {
    logger.info(`signal-sidecar haproxy tcp listener started on: ${config.TCPServerPort}.`);
});
