async function P(e,s){var t,r;try{console.log(`[LibroTube] Fetching transcript for video: ${e}`);let n="";if(typeof document<"u")try{const c=document.querySelectorAll("script");for(const u of Array.from(c)){const l=(u.textContent||"").match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);if(l&&l[1]){n=l[1];break}}if(!n){const u=document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);u&&u[1]&&(n=u[1])}}catch(c){console.warn("Error extracting API key from page DOM:",c)}if(!n){const c=`https://www.youtube.com/watch?v=${e}`,u=await fetch(c,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}});if(!u.ok)throw new Error(`Failed to fetch YouTube watch page: ${u.statusText}`);const l=(await u.text()).match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);if(!l||!l[1])throw new Error("Could not find INNERTUBE_API_KEY from watch page HTML.");n=l[1]}const i=`https://www.youtube.com/youtubei/v1/player?key=${n}`,o=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"},body:JSON.stringify({context:{client:{clientName:"ANDROID",clientVersion:"20.10.38"}},videoId:e})}).then(c=>{if(!c.ok)throw new Error(`InnerTube v1/player API call failed: ${c.statusText}`);return c.json()}),a=o.playabilityStatus;if(a&&a.status!=="OK")throw new Error(`Video playability status is ${a.status}: ${a.reason||"Unknown reason"}`);const p=(r=(t=o.captions)==null?void 0:t.playerCaptionsTracklistRenderer)==null?void 0:r.captionTracks;if(!p||p.length===0)throw new Error("No transcript tracks found for this video.");const m=C(p);if(!m)throw new Error("No suitable transcript track could be selected.");let h=m.baseUrl;h.includes("fmt=srv3")?h=h.replace("fmt=srv3","fmt=json3"):h.includes("fmt=")||(h=`${h}&fmt=json3`),m.languageCode.startsWith("en")||(h+="&tlang=en");const f=await fetch(h,{headers:{"User-Agent":"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"}});if(!f.ok)throw new Error(`Failed to fetch caption data: ${f.statusText}`);const y=await f.text();if(!y.trim())throw new Error("Caption response was empty (YouTube returned no data).");try{const c=JSON.parse(y);return D(c)}catch(c){throw new Error(`Failed to parse caption JSON: ${c.message}. Content preview: ${y.slice(0,100)}`)}}catch(n){throw console.error("Error in fetchTranscript:",n),n}}function C(e){const s=e.find(n=>n.languageCode.startsWith("en")&&!n.vssId.startsWith("a."));if(s)return s;const t=e.find(n=>!n.vssId.startsWith("a."));if(t)return t;const r=e.find(n=>n.languageCode.startsWith("en"));return r||e[0]||null}function D(e){if(!e.events)return[];const s=[];for(const t of e.events){if(!t.segs||t.segs.length===0)continue;const r=t.segs.map(o=>o.utf8).join("").trim();if(!r)continue;const n=t.tStartMs/1e3,i=(t.dDurationMs||0)/1e3;s.push({text:r,start:n,duration:i})}return s}async function $(e,s,t,r){if(!t.apiKey)throw new Error("Google AI Studio API Key is missing. Please configure it in extension options.");if(!s||s.length===0){console.log(`[LibroTube] Captions not available for video ${e}. Using metadata-only summary fallback.`);const i=await L(r,t),o=await O(r,i.summary,t),a=`<p class="metadata-only-notice" style="font-style: italic; opacity: 0.8; margin-bottom: 1.5rem; padding: 0.75rem; border-left: 3px solid var(--accent); background: rgba(212, 175, 55, 0.05);">
      [No transcript or caption track was found for this video. The following summary and critique were generated based on the video's title, author, and description.]
    </p>
    <h3>Video Metadata</h3>
    <p><strong>Title:</strong> ${(r==null?void 0:r.title)||"Unknown"}</p>
    <p><strong>Channel:</strong> ${(r==null?void 0:r.author)||"Unknown"}</p>
    <p><strong>Description:</strong></p>
    <pre style="white-space: pre-wrap; font-family: var(--font-sans); font-size: 0.9em; opacity: 0.75; line-height: 1.5; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); max-height: 400px; overflow-y: auto;">${(r==null?void 0:r.description)||"No description provided."}</pre>`;return{videoId:e,summary:i.summary,strengths:i.strengths,weaknesses:i.weaknesses,critique:o,formattedTranscript:a,createdAt:Date.now()}}const n=M(s);try{const i=s.map(p=>`[${p.start.toFixed(1)}s] ${p.text}`).join(`
`),o=await q(i,t,r),a=await U(i,o.summary,t,r);return{videoId:e,summary:o.summary,strengths:o.strengths,weaknesses:o.weaknesses,critique:a,formattedTranscript:n,createdAt:Date.now()}}catch(i){throw console.error("Error in AI content generation:",i),i}}function M(e){if(e.length===0)return"No transcript text available.";let s="",t="",r=e[0].start,n=0;const i=o=>{const a=Math.floor(o/60),p=Math.floor(o%60);return`${a}:${p.toString().padStart(2,"0")}`};for(const o of e)o.start-n>2&&t.trim()&&(s+=`<p><span class="transcript-timestamp" data-time="${r}">[${i(r)}]</span> ${t.trim()}</p>
`,t="",r=o.start),t+=" "+o.text,n=o.start+o.duration;return t.trim()&&(s+=`<p><span class="transcript-timestamp" data-time="${r}">[${i(r)}]</span> ${t.trim()}</p>
`),s}async function b(e,s,t,r=!1){var a,p,m,h,f,y,c,u;let n=0;const i=3;let o=1500;for(;n<i;)try{const d={contents:[{parts:[{text:s}]}]};e&&(d.systemInstruction={parts:[{text:e}]}),r&&(d.generationConfig={responseMimeType:"application/json"});const l=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","X-goog-api-key":t.apiKey},body:JSON.stringify(d)});if(!l.ok){const v=await l.text();let g;try{g=JSON.parse(v)}catch{}const E=((a=g==null?void 0:g.error)==null?void 0:a.message)||v;if(l.status===503&&n<i-1){console.warn(`[LibroTube] Gemini API returned 503 (High Demand). Retrying in ${o}ms... (Attempt ${n+1}/${i})`),await new Promise(N=>setTimeout(N,o)),n++,o*=2;continue}throw new Error(`Gemini API returned status ${l.status}: ${E}`)}const T=(y=(f=(h=(m=(p=(await l.json()).candidates)==null?void 0:p[0])==null?void 0:m.content)==null?void 0:h.parts)==null?void 0:f[0])==null?void 0:y.text;if(!T)throw new Error("Gemini API returned an empty or invalid response structure.");return T}catch(d){if(n<i-1&&((c=d.message)!=null&&c.includes("503")||(u=d.message)!=null&&u.includes("Failed to fetch"))){console.warn(`[LibroTube] Retrying after error: ${d.message}. Retrying in ${o}ms... (Attempt ${n+1}/${i})`),await new Promise(l=>setTimeout(l,o)),n++,o*=2;continue}throw d}throw new Error("Failed to contact Gemini API after multiple retries.")}async function q(e,s,t){const r=`You are a professional research editor.
Analyze the provided YouTube transcript (which includes timestamps in [seconds] like [12.5s]).
Generate:
1. A concise, 3-4 sentence summary of the video.
2. 5 positive key points (strengths/merits/claims) with exact quotes and timestamps.
3. 5 negative/critical key points (weaknesses/omissions/logical flaws) with exact quotes and timestamps.

You MUST respond ONLY with a JSON object of this structure:
{
  "summary": "3-4 sentence summary here",
  "strengths": [
    { "point": "Description of the strength", "quote": "Exact short quote", "timestamp": 12.5 }
  ],
  "weaknesses": [
    { "point": "Description of the weakness", "quote": "Exact short quote", "timestamp": 45.0 }
  ]
}
Ensure timestamps are numbers in seconds (e.g. 12.5) matching the closest stamp in the transcript.`,i=`${t?`Video Title: ${t.title||""}
Channel: ${t.author||""}
Description: ${t.description||""}

`:""}Here is the transcript:

${e.slice(0,32e3)}`,o=await b(r,i,s,!0);try{return JSON.parse(o)}catch(a){throw new Error(`Failed to parse AI JSON response: ${a.message}. Content was: ${o}`)}}async function U(e,s,t,r){const n=t.customCritiquePrompt||"",i=`You are a mercilessly honest, sarcastic editor and book critic.
Analyze the provided video transcript and its summary.
Write a brutally honest, critical, and slightly sarcastic evaluation/critique of this video.
Point out logical fallacies, bias, factual errors, weak arguments, hand-waving, marketing fluff, or poor structure.
If the video is actually good, acknowledge it with begrudging respect, but still point out where it could be better.
Always ground your critique in the transcript.
Format your response in clean markdown paragraphs. Use bolding and lists if helpful.`,a=`${r?`Video Title: ${r.title||""}
Channel: ${r.author||""}
`:""}Summary: ${s}

Transcript:

${e.slice(0,25e3)}

${n}`;return await b(i,a,t,!1)}async function L(e,s){const t=`You are an elite research librarian, academic editor, and literary analyst.
Analyze the provided YouTube video metadata (Title, Channel, and Description).
Since no caption/transcript is available, you must generate a comprehensive summary and analysis based on this metadata:
1. A concise, 3-4 sentence analytical summary of the video's expected content, topic, and thesis.
2. 3 expected strengths/merits/claims (positive key points) of the video based on the metadata. Use a quote from the description if possible, and set the timestamp to 0.
3. 3 expected weaknesses/omissions/biases (negative key points) of the video based on the metadata. Use a quote or reference from the description if possible, and set the timestamp to 0.

You MUST respond ONLY with a JSON object of this structure:
{
  "summary": "3-4 sentence summary here",
  "strengths": [
    { "point": "Description of the strength", "quote": "Short quote or reference from description", "timestamp": 0 }
  ],
  "weaknesses": [
    { "point": "Description of the weakness/bias", "quote": "Short quote or reference from description", "timestamp": 0 }
  ]
}
Do not add any prose or markdown outside the JSON block. Ensure the JSON is valid and parsable.`,r=`Video Title: ${(e==null?void 0:e.title)||"Unknown"}
Channel: ${(e==null?void 0:e.author)||"Unknown"}
Description: ${(e==null?void 0:e.description)||"No description provided."}`,n=await b(t,r,s,!0);try{return JSON.parse(n)}catch(i){throw new Error(`Failed to parse metadata summary JSON: ${i.message}. Content was: ${n}`)}}async function O(e,s,t){const r=`You are a cynical, highly intellectual academic reviewer and video analyst.
You are reviewing a video that does not have a transcript, based only on its title, channel, description, and summary.
Provide an extremely deep, rigorous, and intellectually sophisticated critique of the video's expected thesis, potential biases, and logical gaps based on its metadata and summary.
Your tone should be dry, sharp, slightly cynical, and highly scholarly (evoking an "old money, gothic vampire core library" vibe—like a critique written by a timeless scholar in a dusty archive).
Format your response in markdown. Do not include any JSON or other markers.`,n=`Video Title: ${(e==null?void 0:e.title)||"Unknown"}
Channel: ${(e==null?void 0:e.author)||"Unknown"}
Description: ${(e==null?void 0:e.description)||"No description provided."}

Summary: ${s}`;return await b(r,n,t,!1)}const K="LibroTubeDB",w="cached_videos",I=1;function k(){return new Promise((e,s)=>{const t=indexedDB.open(K,I);t.onerror=()=>s(t.error),t.onsuccess=()=>e(t.result),t.onupgradeneeded=r=>{const n=t.result;n.objectStoreNames.contains(w)||n.createObjectStore(w,{keyPath:"videoId"})}})}async function x(e){try{const s=await k();return new Promise((t,r)=>{const n=s.transaction(w,"readonly"),o=n.objectStore(n.objectStoreNames[0]||w).get(e);o.onerror=()=>r(o.error),o.onsuccess=()=>t(o.result||null)})}catch(s){return console.error("Error reading from IndexedDB:",s),null}}async function A(e){try{const s=await k();return new Promise((t,r)=>{const n=s.transaction(w,"readwrite"),o=n.objectStore(n.objectStoreNames[0]||w).put(e);o.onerror=()=>r(o.error),o.onsuccess=()=>t()})}catch(s){console.error("Error writing to IndexedDB:",s)}}const _={provider:"gemini",apiKey:"AQ.Ab8RN6J1bTyIMAnl8562LdYSyvadcicZiyXpU5_eZt6zzNhnfQ",theme:"auto"};async function S(){return new Promise(e=>{chrome.storage.local.get(["settings"],s=>{const t={..._,...s.settings};t.provider!=="gemini"&&(t.provider="gemini",t.apiKey||(t.apiKey="AQ.Ab8RN6J1bTyIMAnl8562LdYSyvadcicZiyXpU5_eZt6zzNhnfQ")),e(t)})})}chrome.runtime.onMessage.addListener((e,s,t)=>{if(e.action==="getVideoContent"){const{videoId:r,segments:n,metadata:i}=e;return Y(r,n,i).then(o=>t({success:!0,content:o})).catch(o=>t({success:!1,error:o.message})),!0}if(e.action==="preFetchVideo"){const{videoId:r}=e;return j(r).then(()=>t({success:!0})).catch(()=>t({success:!1})),!0}});async function Y(e,s,t){const r=await x(e);if(r)return console.log(`[LibroTube] Serving cached content for video: ${e}`),r;console.log(`[LibroTube] Generating AI content from content-script-provided segments for video: ${e}`);const n=await S(),i=await $(e,s,n,t);return await A(i),i}async function j(e){if(!await x(e))try{let t=null;try{t=await P(e)}catch(i){console.warn(`[LibroTube] Pre-fetch transcript extraction failed for video ${e}. Will use LLM fallback:`,i)}const r=await S(),n=await $(e,t,r);await A(n),console.log(`[LibroTube] Successfully pre-fetched and cached video: ${e}`)}catch(t){console.warn(`[LibroTube] Pre-fetch failed for video ${e}:`,t)}}
