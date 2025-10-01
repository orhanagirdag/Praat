# Praat

Praat is een experimentele taalcoach voor anderstalige nieuwkomers. De app laat gebruikers vrijuit spreken via de microfoon en gebruikt de OpenAI Realtime-stack om automatisch te transcriberen, het taalniveau in te schatten en een gesproken reactie terug te geven.

## Belangrijkste mogelijkheden

- 🎤 **Eén-knops interface**: houd de microfoontoets ingedrukt om een beurt op te nemen.
- 🧠 **Adaptieve tutor**: het taalniveau wordt per beurt geüpdatet en de chatbot past zijn toon hierop aan.
- 🔁 **Gespreksgeheugen**: eerdere beurten worden meegestuurd zodat de tutor context houdt.
- 🔊 **Directe audiofeedback**: antwoorden worden zowel als tekst als audio (mp3) teruggestuurd.

## Installatie en gebruik

1. Zorg dat je een recente versie van Node.js (18+) hebt.
2. Installeer de dependencies:
   ```bash
   npm install
   ```
3. Zet je OpenAI API-sleutel als omgevingsvariabele `API1` (bijvoorbeeld via `.env` of je shell-profiel).
4. Start de server:
   ```bash
   npm start
   ```
5. Open je browser op [http://localhost:3000](http://localhost:3000) en geef de site toegang tot de microfoon.

> ⚠️ Let op: deze referentie-implementatie gebruikt een in-memory sessiestore. Voor productiegebruik (bijvoorbeeld voor app store-publicatie) is een robuuste opslag- en authenticatielaag nodig.

## Architectuur

- **Frontend**: statische HTML/CSS/JS met de MediaRecorder API voor spraakopname en audio-afspeel.
- **Backend**: Express-server die audio transcribeert (`gpt-4o-transcribe`), een JSON-antwoord genereert (`gpt-4o-mini`) en tekst omzet naar spraak (`gpt-4o-mini-tts`).
- **Sessies**: eenvoudige cookie-gebaseerde identificatie met in-memory opslag van conversatiegeschiedenis en geschat taalniveau.

## Verdere stappen

- Opslag van gesprekken en taalniveau in een database (bijv. Postgres) voor persistente profielen.
- Toevoegen van WebRTC voor echte realtime-duplex-audio.
- Integratie van analytics en progressie-tracking om begeleiding te personaliseren.
- Uitbreiding met meertalige instructies voor onboarding en tutorials.
