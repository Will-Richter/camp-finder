# Makes the Camp Finder ad voiceover with Google's Australian voices, one WAV per line, zipped.
import json, subprocess, base64, urllib.request, zipfile
tok = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
H = {"Authorization": "Bearer " + tok, "x-goog-user-project": "camp-finder-512209", "Content-Type": "application/json"}
LINES = [
    "Where are you camping tonight?",
    "Camp Finder plans a camp for every night of your trip.",
    "Running late? It finds somewhere beautiful you'll reach before dark.",
    "Over ten thousand free camps, national parks and caravan parks.",
    "Every four-wheel-drive track in Australia, from Gurri to the Cape.",
    "No signal? No worries. It all works offline.",
    "Camp Finder. Download it free on the App Store.",
]
VOICES = ["Puck", "Achird", "Aoede", "Laomedeia"]
z = zipfile.ZipFile("cf_vo.zip", "w")
for v in VOICES:
    for i, t in enumerate(LINES, 1):
        body = {"input": {"text": t}, "voice": {"languageCode": "en-AU", "name": "en-AU-Chirp3-HD-" + v},
                "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": 24000}}
        r = urllib.request.Request("https://texttospeech.googleapis.com/v1/text:synthesize", data=json.dumps(body).encode(), headers=H)
        d = json.load(urllib.request.urlopen(r))
        name = f"{v}_l{i}.wav"
        open(name, "wb").write(base64.b64decode(d["audioContent"]))
        z.write(name)
        print("made", name)
z.close()
print("DONE cf_vo.zip")
