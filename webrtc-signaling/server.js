// WebRTC Signaling Server
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const url = require('url');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS middleware
app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.header(
		'Access-Control-Allow-Headers',
		'Origin, X-Requested-With, Content-Type, Accept, Authorization'
	);
	if (req.method === 'OPTIONS') {
		res.sendStatus(200);
	} else {
		next();
	}
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

// Health check endpoint
app.get('/health', (req, res) => {
	res.json({
		status: 'OK',
		timestamp: new Date().toISOString(),
		connectedPeers: peers.size,
		uptime: process.uptime(),
	});
});

// Peer list endpoint
app.get('/peers', (req, res) => {
	const peerList = Array.from(peers.keys()).map((id) => ({
		id,
		connected: peers.get(id)?.readyState === 1,
	}));
	res.json({ peers: peerList });
});

const wss = new WebSocketServer({
	server,
	path: '/ws',
	perMessageDeflate: false, // Disabled to keep latency predictable
});

const peers = new Map();
const messageQueue = new Map(); // Temporary message queue (reserved for future use)
let totalConnections = 0;
let totalMessages = 0;

function logActivity(message) {
	console.log(`[${new Date().toISOString()}] ${message}`);
}

function broadcastSystemMessage(event, data = {}) {
	const message = JSON.stringify({
		type: 'system',
		event,
		...data,
		timestamp: Date.now(),
	});
	peers.forEach((ws) => {
		if (ws.readyState === 1) {
			try {
				ws.send(message);
				} catch (error) {
					logActivity(`System message delivery error: ${error.message}`);
			}
		}
	});
}

function cleanupPeer(id, ws) {
	if (peers.get(id) === ws) {
		peers.delete(id);
		logActivity(`Peer disconnected: ${id} (total: ${peers.size})`);

			// Notify other peers about the disconnect event
		broadcastSystemMessage('peer_disconnected', { id });
	}
}

wss.on('connection', (ws, req) => {
	const clientIP =
		req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	totalConnections++;

	let peerId = null;
	let isAuthenticated = false;

	try {
		const { query } = url.parse(req.url, true);
		peerId = query.id;

		if (!peerId || typeof peerId !== 'string' || peerId.trim().length === 0) {
			logActivity(`Invalid peer ID from ${clientIP}`);
			return ws.close(1008, 'Missing or invalid peer ID');
		}

		peerId = peerId.trim();

		// ID format validation (alphanumeric, dash, underscore)
		if (!/^[a-zA-Z0-9_-]+$/.test(peerId)) {
			logActivity(`Invalid peer ID format: ${peerId} from ${clientIP}`);
			return ws.close(1008, 'Invalid peer ID format');
		}

			// Terminate any previous connection that still exists
		if (peers.has(peerId)) {
			const oldWs = peers.get(peerId);
			try {
				oldWs.close(1012, 'Replaced by new connection');
			} catch (error) {
				logActivity(`Error closing old connection: ${error.message}`);
			}
		}

		ws.id = peerId;
		ws.connectedAt = Date.now();
		ws.lastActivity = Date.now();
		ws.messageCount = 0;
		peers.set(peerId, ws);
		isAuthenticated = true;

		logActivity(
			`Peer connected: ${peerId} from ${clientIP} (total: ${peers.size})`
		);

			// Send a welcome message to the new peer
		try {
			ws.send(
				JSON.stringify({
					type: 'system',
					event: 'welcome',
					id: peerId,
					timestamp: Date.now(),
					totalPeers: peers.size,
				})
			);
		} catch (error) {
			logActivity(`Welcome message send error: ${error.message}`);
		}

			// Broadcast the new peer to the rest of the network
		broadcastSystemMessage('peer_connected', { id: peerId });
	} catch (error) {
		logActivity(`Connection setup error: ${error.message}`);
		return ws.close(1011, 'Server error during setup');
	}

	// Heartbeat
	const heartbeatInterval = setInterval(() => {
		if (ws.readyState === 1) {
			try {
				ws.ping();
			} catch (error) {
				logActivity(`Ping error for ${peerId}: ${error.message}`);
				clearInterval(heartbeatInterval);
			}
		} else {
			clearInterval(heartbeatInterval);
		}
	}, 30000); // 30 seconds

	ws.on('pong', () => {
		ws.lastActivity = Date.now();
	});

	ws.on('message', (raw) => {
		if (!isAuthenticated) return;

		ws.lastActivity = Date.now();
		ws.messageCount++;
		totalMessages++;

		let msg;
		try {
			msg = JSON.parse(raw.toString());
		} catch (error) {
			logActivity(`JSON parse error from ${peerId}: ${error.message}`);
			try {
				ws.send(
					JSON.stringify({
						type: 'system',
						event: 'error',
						message: 'Invalid JSON format',
					})
				);
			} catch {}
			return;
		}

		// Message validation
		if (!msg.type || !msg.to) {
			logActivity(`Invalid message format from ${peerId}`);
			try {
				ws.send(
					JSON.stringify({
						type: 'system',
						event: 'error',
						message: 'Missing required fields: type, to',
					})
				);
			} catch {}
			return;
		}

		msg.from = peerId;
		msg.timestamp = Date.now();

		logActivity(`[MSG] from: ${peerId} to: ${msg.to} type: ${msg.type}`);

		const dst = peers.get(msg.to);
		if (!dst) {
			logActivity(`Peer unavailable: ${msg.to}`);
			try {
				ws.send(
					JSON.stringify({
						type: 'system',
						event: 'peer_unavailable',
						to: msg.to,
						timestamp: Date.now(),
					})
				);
			} catch (error) {
				logActivity(`Error sending peer_unavailable: ${error.message}`);
			}
			return;
		}

		if (dst.readyState !== 1) {
			logActivity(
				`Destination peer ${msg.to} not ready (readyState: ${dst.readyState})`
			);
			try {
				ws.send(
					JSON.stringify({
						type: 'system',
						event: 'peer_unavailable',
						to: msg.to,
						reason: 'Peer connection not ready',
						timestamp: Date.now(),
					})
				);
			} catch {}
			return;
		}

		try {
			dst.send(JSON.stringify(msg));
			logActivity(`Message delivered: ${peerId} -> ${msg.to} (${msg.type})`);
		} catch (error) {
			logActivity(`Message delivery error: ${error.message}`);
			try {
				ws.send(
					JSON.stringify({
						type: 'system',
						event: 'delivery_failed',
						to: msg.to,
						error: error.message,
						timestamp: Date.now(),
					})
				);
			} catch {}
		}
	});

	ws.on('close', (code, reason) => {
		clearInterval(heartbeatInterval);
		isAuthenticated = false;

		const reasonStr = reason?.toString() || 'No reason';
		logActivity(
			`Peer ${peerId} disconnected: code=${code}, reason=${reasonStr}`
		);

		if (peerId) {
			cleanupPeer(peerId, ws);
		}
	});

	ws.on('error', (error) => {
		logActivity(`WebSocket error for ${peerId}: ${error.message}`);
		clearInterval(heartbeatInterval);
	});
});

wss.on('error', (error) => {
	logActivity(`WebSocket Server error: ${error.message}`);
});

// Cleanup inactive connections
setInterval(() => {
	const now = Date.now();
	const timeout = 60000; // 1 minute

	peers.forEach((ws, id) => {
		if (now - ws.lastActivity > timeout) {
			logActivity(`Cleaning up inactive peer: ${id}`);
			try {
				ws.close(1000, 'Inactive timeout');
			} catch (error) {
				logActivity(`Error closing inactive peer: ${error.message}`);
			}
		}
	});
	}, 30000); // Check every 30 seconds

// Graceful shutdown
function gracefulShutdown() {
	logActivity('Starting graceful shutdown...');

	// Close all active connections
	peers.forEach((ws, id) => {
		try {
			ws.close(1001, 'Server shutting down');
		} catch (error) {
			logActivity(`Error closing connection for ${id}: ${error.message}`);
		}
	});

	wss.close(() => {
		logActivity('WebSocket server closed');
		server.close(() => {
			logActivity('HTTP server closed');
			process.exit(0);
		});
	});
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('uncaughtException', (error) => {
	logActivity(`Uncaught exception: ${error.message}`);
	logActivity(error.stack);
	gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
	logActivity(`Unhandled rejection: ${reason}`);
	logActivity(`Promise: ${promise}`);
});

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
	logActivity(`WebRTC Signaling Server started on ${HOST}:${PORT}`);
	logActivity(`WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
	logActivity(`Health check: http://${HOST}:${PORT}/health`);
	logActivity(`Peer list: http://${HOST}:${PORT}/peers`);
});
