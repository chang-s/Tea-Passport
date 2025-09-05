const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");
const { randomUUID } = require("crypto");

// Cosmos client (reads SWA env vars set in the portal)
const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
});
const db = client.database(process.env.COSMOS_DB);
const users = db.container("users");
const events = db.container("events");
const checkins = db.container("checkins");

app.http("checkin", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (request, context) => {
        try {
            const body = await request.json().catch(() => ({}));
            const email = String(body.email || "").toLowerCase().trim();
            const eventCode = String(body.eventCode || "").toUpperCase().trim();
            const name = String(body.name || "").trim();

            if (!email || !eventCode) {
                return { status: 400, jsonBody: { error: "email and eventCode required" } };
            }

            // 1) find event by code (case-insensitive)
            const evq = await events.items
                .query({
                    query: "SELECT * FROM c WHERE UPPER(c.code) = @code",
                    parameters: [{ name: "@code", value: eventCode }],
                })
                .fetchAll();
            const ev = evq.resources[0];
            if (!ev) return { status: 400, jsonBody: { error: "invalid eventCode" } };

            // 2) upsert user by email
            const uq = await users.items
                .query({
                    query: "SELECT * FROM c WHERE c.email = @e",
                    parameters: [{ name: "@e", value: email }],
                })
                .fetchAll();
            let user = uq.resources[0];
            if (!user) {
                user = {
                    id: randomUUID(),
                    email,
                    name: name || email.split("@")[0],
                    createdAt: new Date().toISOString(),
                };
                await users.items.create(user);
            }

            // 3) idempotent check-in (avoid duplicates)
            const chkId = `${user.id}_${ev.id}`;
            try {
                await checkins.items.create({
                    id: chkId,
                    userId: user.id,
                    eventId: ev.id,
                    createdAt: new Date().toISOString(),
                });
            } catch (_) {
                // duplicate insert is fine
            }

            return { status: 200, jsonBody: { ok: true, userId: user.id, eventId: ev.id } };
        } catch (err) {
            context.log.error(err);
            return { status: 500, jsonBody: { error: "server_error" } };
        }
    },
});