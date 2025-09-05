const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
});
const db = client.database(process.env.COSMOS_DB);
const users = db.container("users");
const events = db.container("events");
const checkins = db.container("checkins");

app.http("profile", {
    methods: ["GET"],
    authLevel: "anonymous",
    handler: async (request, context) => {
        try {
            const email = String(new URL(request.url).searchParams.get("email") || "")
                .toLowerCase()
                .trim();
            if (!email) return { status: 400, jsonBody: { error: "email required" } };

            const uq = await users.items
                .query({
                    query: "SELECT * FROM c WHERE c.email = @e",
                    parameters: [{ name: "@e", value: email }],
                })
                .fetchAll();
            const user = uq.resources[0];
            if (!user) return { status: 404, jsonBody: { error: "user_not_found" } };

            const cq = await checkins.items
                .query({
                    query: "SELECT c.eventId FROM c WHERE c.userId = @u",
                    parameters: [{ name: "@u", value: user.id }],
                })
                .fetchAll();
            const ids = cq.resources.map((c) => c.eventId);

            let badges = [];
            if (ids.length) {
                const evs = await events.items
                    .query({
                        query: "SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.id)",
                        parameters: [{ name: "@ids", value: ids }],
                    })
                    .fetchAll();
                badges = evs.resources.map((e) => ({ name: e.name, badgeUrl: e.badgeUrl }));
            }

            return { status: 200, jsonBody: { user: { email: user.email, name: user.name }, badges } };
        } catch (err) {
            context.log.error(err);
            return { status: 500, jsonBody: { error: "server_error" } };
        }
    },
});
