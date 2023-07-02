import "dotenv/config";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { ofetch } from "ofetch";
import { listen } from "listhen";
import crypto from "node:crypto";
import {
    createApp,
    createRouter,
    eventHandler,
    getQuery,
    parseCookies,
    sendRedirect,
    setCookie,
    toNodeListener,
} from "h3";

const storage = createStorage({
    // @ts-expect-error
    driver: fsDriver({ base: "./storage" }),
});

const app = createApp();

const router = createRouter()
    .get(
        "/",
        eventHandler(() => "Hello world!")
    )
    .get(
        "/login",
        eventHandler((event) => {
            let state = crypto.randomBytes(16).toString("hex");
            let scope = "user-library-read";

            setCookie(event, "spotify_oauth_state", state, {
                path: "/",
                maxAge: 60 * 60,
            });

            return sendRedirect(
                event,
                "https://accounts.spotify.com/authorize?" +
                    new URLSearchParams({
                        response_type: "code",
                        client_id: process.env.CLIENT_ID!,
                        scope: scope,
                        redirect_uri: process.env.REDIRECT_URI!,
                        state: state,
                    })
            );
        })
    )
    .get(
        "/callback",
        eventHandler(async (event) => {
            const params = getQuery(event);

            let code = params.code || null;
            let state = params.state || null;

            if (parseCookies(event).spotify_oauth_state !== state) {
                return { error: "state issue" };
            } else {
                let response = await ofetch(
                    "https://accounts.spotify.com/api/token",
                    {
                        method: "POST",
                        headers: {
                            Authorization:
                                "Basic " +
                                Buffer.from(
                                    process.env.CLIENT_ID +
                                        ":" +
                                        process.env.CLIENT_SECRET
                                ).toString("base64"),
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        body: new URLSearchParams({
                            code: String(code),
                            redirect_uri: process.env.REDIRECT_URI!,
                            grant_type: "authorization_code",
                        }),
                        parseResponse: JSON.parse,
                    }
                );

                await storage.setItem(
                    "auth:access_token",
                    response.access_token
                );
                await storage.setItem(
                    "auth:refresh_token",
                    response.refresh_token
                );

                return response;
            }
        })
    );

setInterval(async () => {
    if (await storage.hasItem("auth:access_token")) {
        let { items } = await ofetch("https://api.spotify.com/v1/me/tracks", {
            headers: {
                Authorization: `Bearer ${await storage.getItem(
                    "auth:access_token"
                )}`,
            },
        });

        console.log(items)
    } else {
        console.log("no token :(");
    }
}, 5000);

app.use(router);

listen(toNodeListener(app));
