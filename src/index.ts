import "dotenv/config";
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
import { ofetch } from "ofetch";
import { listen } from "listhen";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import crypto from "node:crypto";
import { downloadFromDeezer } from "./deemix.js";

const storage = createStorage({
    // @ts-expect-error
    driver: fsDriver({ base: "./storage" }),
});

const app = createApp();

const router = createRouter()
    .get(
        "/",
        eventHandler(() => '<a href="/login">login</a>')
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

                return "<h2>yay</h2>";
            }
        })
    );

setInterval(async () => {
    if (await storage.hasItem("auth:access_token")) {
        let items: Item[];

        try {
            let response = await ofetch(
                "https://api.spotify.com/v1/me/tracks",
                {
                    headers: {
                        Authorization: `Bearer ${await storage.getItem(
                            "auth:access_token"
                        )}`,
                    },
                }
            );

            items = response.items;
        } catch {
            let { access_token } = await ofetch(
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
                        refresh_token: (await storage.getItem(
                            "auth:refresh_token"
                        )) as string,
                        grant_type: "refresh_token",
                    }),
                }
            );

            console.log("Access token refreshed");
            await storage.setItem("auth:access_token", access_token);
            return;
        }

        let newSongs = items.map((item) => {
            return {
                url: item.track.external_urls.spotify,
                name: item.track.name,
            };
        });

        let oldSongs = await storage.getItem<typeof newSongs>("liked_songs");

        if (oldSongs == null) {
            await storage.setItem("liked_songs", newSongs);
        } else {
            const difference = newSongs.filter(
                (newSong) =>
                    !oldSongs!.some((oldSong) => oldSong.url === newSong.url)
            );

            for (let i = 0; i < difference.length; i++) {
                console.log(`Starting download for ${difference[i].name}`);

                try {
                    await downloadFromDeezer(difference[i]);
                } catch {
                    console.log(`Download failed for ${difference[i].name}`);

                    let failedSongs = await storage.getItem<typeof newSongs>(
                        "failed_songs"
                    );

                    if (failedSongs == null) {
                        await storage.setItem("failed_songs", [difference[i]]);
                    } else {
                        await storage.setItem(
                            "failed_songs",
                            failedSongs.concat(difference[i])
                        );
                    }
                }
            }

            await storage.setItem("liked_songs", oldSongs!.concat(difference));
        }
    } else {
        console.log("not authorized :(");
    }
}, 20000);

app.use(router);

listen(toNodeListener(app));

interface Item {
    added_at: string;
    track: Track;
}

interface Track {
    album: Album;
    artists: Artist[];
    available_markets: string[];
    disc_number: number;
    duration_ms: number;
    explicit: boolean;
    external_ids: Externalids;
    external_urls: Externalurls;
    href: string;
    id: string;
    is_local: boolean;
    name: string;
    popularity: number;
    preview_url?: string;
    track_number: number;
    type: string;
    uri: string;
}

interface Externalids {
    isrc: string;
}

interface Album {
    album_type: string;
    artists: Artist[];
    available_markets: string[];
    external_urls: Externalurls;
    href: string;
    id: string;
    images: Image[];
    name: string;
    release_date: string;
    release_date_precision: string;
    total_tracks: number;
    type: string;
    uri: string;
}

interface Image {
    height: number;
    url: string;
    width: number;
}

interface Artist {
    external_urls: Externalurls;
    href: string;
    id: string;
    name: string;
    type: string;
    uri: string;
}

interface Externalurls {
    spotify: string;
}
