// @ts-ignore
import deemix from "deemix";
// @ts-ignore
import { Deezer } from "deezer-js";

let dz = new Deezer();

const Downloader = deemix.downloader.Downloader;

let settings = deemix.settings.load(deemix.utils.localpaths.getConfigFolder());

let plugins = {
    spotify: new deemix.plugins.spotify(),
};

plugins.spotify.setup();

const spotifySettings = plugins.spotify.getSettings();

if (!spotifySettings.clientId && !spotifySettings.clientSecret) {
    if (!process.env.CLIENT_ID && !process.env.CLIENT_SECRET)
        throw new Error("client id and secret environment variables missing");

    const newSpotifySettings: SpotifySettings = {
        clientId: process.env.CLIENT_ID!,
        clientSecret: process.env.CLIENT_SECRET!,
        fallbackSearch: false,
    };

    plugins.spotify.saveSettings(newSpotifySettings);
}

await dz.login_via_arl(process.env.DEEZER_ARL);

export async function downloadFromDeezer(song: { url: string; name: string }) {
    let dlObj = await deemix.generateDownloadObject(dz, song.url, 9, plugins);

    let currentJob = new Downloader(dz, dlObj, settings);

    await currentJob.start().then(() => {
        if (dlObj.failed === dlObj.size && dlObj.size !== 0) {
            console.log(`Download failed for ${song.name}`);
        } else {
            console.log(`Download complete for ${song.name}`);
        }
    });
}

interface SpotifySettings {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    fallbackSearch?: boolean;
}
