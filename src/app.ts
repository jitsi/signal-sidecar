import config from './config';
import express from 'express';
import logger from './logger';
import HealthCollector, { HealthReport } from './health_collector';
import CensusCollector from './census_collector';
import metrics from './metrics';
import * as net from 'net';

logger.info('signal-sidecar startup', { config });

/////////////////////////
// health polling counter
// counts health polls, report every hour how many have been conducted and
// current health report. this is intended as a sanity check in case
// signal-sidecar ends up on an instance that is resource starved.
let lastPollCheckTime: number = new Date().valueOf();
let currentPollCount = 0;
const pollCheckDurationSeconds = 3600;
const idealPollCount = pollCheckDurationSeconds / config.PollingInterval;
logger.info('initalizing health polling counter', {
    pollingDuration: pollCheckDurationSeconds,
    pollingTarget: idealPollCount,
});

let lastTimeWentHealthy: number;

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
// runs the main health_collector poll against jicofo, prosody, and the status file.
const healthCollector = new HealthCollector({
    jicofoHealthUrl: config.JicofoOrig + '/about/health',
    jicofoStatsUrl: config.JicofoOrig + '/stats',
    prosodyHealthUrl: config.ProsodyOrig + '/http-bind',
    statusFilePath: config.StatusPath,
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

    if (currentParticipants === undefined || currentParticipants == null) {
        logger.warn('weight set to 0% due to missing jicofoParticipants', { report: healthReport });
        return '0%';
    }

    // scales node weight based on current participants vs. maximum by increments of 5%, minimum of 1%
    const weight = Math.max(
        1,
        Math.round((100 - Math.floor(currentParticipants / config.ParticipantMax) * 100) / 5) * 5,
    );
    return `${weight}%`;
}

// init flap mitigation timestamps to something meaningless
let firstTimeWentUnhealthy: number = new Date().valueOf() - (3600000 + config.DrainGraceInterval * 1000);
let lastTimeWentUnhealthy: number = new Date().valueOf() - (3600000 + config.HealthDampeningInterval * 1000);

function healthReportRightNow() {
    const nowHealthReport = <HealthReport>JSON.parse(JSON.stringify(healthReport));
    if (nowHealthReport.healthy) {
        // basic health report is good, now check that we're not in the health dampening interval
        if (checkHealthDampeningPeriod()) {
            // report unhealthy until we exit the health dampening interval
            nowHealthReport.healthy = false;
            nowHealthReport.healthdamped = true;
        }
    } else {
        // unhealthy, check if we are in the drain grace period
        if (checkDrainGracePeriod()) {
            logger.debug('in drain grace period: reporting health / drain despite jicofo unhealthy');
            nowHealthReport.healthy = true;
            nowHealthReport.status = 'drain';
            nowHealthReport.healthdamped = true;
        }
    }

    nowHealthReport.agentmessage = tcpAgentMessage(nowHealthReport);

    return nowHealthReport;
}

function checkHealthDampeningPeriod(): boolean {
    // health dampening period is time enforced period after the last unhealthy check before we report healthy again
    return lastTimeWentUnhealthy + config.HealthDampeningInterval * 1000 >= new Date().valueOf();
}

function checkDrainGracePeriod(): boolean {
    // drain grace period is on if:
    // we've ever been healthy and
    // jicofo is unhealthy but otherwise all else is good and
    // the current time is less than window ending at first failure time + grace period
    return (
        lastTimeWentHealthy !== undefined &&
        !healthReport.services.jicofoHealthy &&
        healthReport.services.prosodyHealthy &&
        firstTimeWentUnhealthy + config.DrainGraceInterval * 1000 >= new Date().valueOf()
    );
}

async function pollForHealth() {
    logger.debug('entering pollForHealth', { report: healthReport });
    checkPollCounter();
    try {
        const newHealthReport = await healthCollector.updateHealthReport();

        // inject prosody census stats if we are polling the census
        const censusStats = getCensusStats();
        if (censusStats) {
            newHealthReport.stats = Object.assign({}, newHealthReport.stats, censusStats);
        }

        // dampen health coming back up too quickly
        if (newHealthReport.healthy) {
            lastTimeWentHealthy = new Date().valueOf(); // track when/if ever went healthy
        } else {
            lastTimeWentUnhealthy = new Date().valueOf(); // track when last polled unhealthy
        }
        if (!pollHealthy && newHealthReport.healthy) {
            logger.info('signal node state changed from unhealthy to healthy');
        } else if (pollHealthy && !newHealthReport.healthy) {
            firstTimeWentUnhealthy = new Date().valueOf(); // track when a reported state change to unhealthy began
            logger.info('signal node state changed from healthy to unhealthy');
        }

        pollHealthy = newHealthReport.healthy;
        healthReport = newHealthReport;
    } catch (err) {
        logger.error('pollForHealth error', { err });
        healthReport = initHealthReport;
    }
    setTimeout(pollForHealth, config.PollingInterval * 1000);
}
pollForHealth();

/////////////////////////
// census polling loop
// runs the optional prosody mod_muc_census poll with census_collector
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

function getCensusStats() {
    if (config.CensusPoll) {
        return {
            prosodyParticipants: censusCollector.countCensusParticipants(censusReport),
            prosodySumSquaredParticipants: censusCollector.countCensusSumSquaredParticipants(censusReport),
        };
    }
    return null;
}

////////////////////
// express REST handlers
const app = express();

async function signalReportHandler(req: express.Request, res: express.Response) {
    if (healthReport) {
        const report = healthReportRightNow();
        res.status(200);
        if (!report.healthy) {
            logger.info('/signal/report returned unhealthy', { report });
        }

        res.send(JSON.stringify(report));
    } else {
        logger.warn('/signal/report returned 500 due to no healthReport');
        res.sendStatus(500);
    }
}

async function signalHealthHandler(req: express.Request, res: express.Response) {
    if (config.Metrics) {
        metrics.SignalHealthCheckCounter.inc(1);
    }
    if (healthReport) {
        const report = healthReportRightNow();

        res.status(200);
        if (!report.healthy) {
            logger.info('/signal/health returned 503', { report });
            if (config.Metrics) {
                metrics.SignalHealthCheckUnhealthyCounter.inc(1);
            }
            res.status(503);
            res.send('NOT_OK');
        } else {
            res.send('OK');
        }
    } else {
        logger.warn('/signal/health returned 500 due to no healthReport');
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
// http routing
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
        await signalReportHandler(req, res);
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
// haproxy tcp agent listener for agent-check
// ref: https://cbonte.github.io/haproxy-dconv/2.5/configuration.html#5.2-agent-check

const tcpServer = net.createServer();

tcpServer.on('error', (err) => {
    logger.error('tcp server error', { err });
});

// construct tcp agent response message
function tcpAgentMessage(report: HealthReport): string {
    let message: string[] = [];
    if (report) {
        if (report.healthy) {
            message.push('up');
        } else {
            message.push('down');
        }

        const nodeStatus = report.status.toLowerCase();
        if (nodeStatus === 'ready' || nodeStatus === 'drain' || nodeStatus === 'maint') {
            message.push(nodeStatus);
        } else {
            message.push('drain');
            logger.warn(`tcp agent set drain due to an invalid status ${nodeStatus}`, { report });
        }
        message.push(report.weight);
    } else {
        logger.warn('tcp agent returned down/drain due to missing health report');
        message = ['down', 'drain'];
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

    if (config.Metrics) {
        metrics.SignalHealthCheckCounter.inc(1);
    }

    const report = healthReportRightNow();
    const agentReport = report.agentmessage;

    sock.end(`${agentReport}\n`);
    logger.debug(`${agentReport} reported to ${sock.remoteAddress}:${sock.remotePort}`);
    // TODO: preserve this report, loger.info if the new report is different
    sock.destroy();
});

tcpServer.listen(config.TCPServerPort, '0.0.0.0', () => {
    logger.info(`signal-sidecar haproxy tcp listener started on: ${config.TCPServerPort}.`);
});
