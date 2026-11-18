import { authorLandingVersion } from "./landing-version";

/**
 * The page for authors starts loading with /author's own HTML, before the
 * app's scripts: most visitors are guests, and they should not wait for the
 * app to learn that they are. The inline script creates the frame at once
 * unless this browser keeps a signed-in session (`sb-*-auth-token` of a
 * user who is not anonymous: every guest has an anonymous one) or an invitation
 * (`#invite=`); `AuthorLanding` adopts it, and the cabinet drops it when it
 * shows something else (`dropUnclaimedLandingFrame`).
 */
export const landingFrameId = "author-landing-frame";
/** Where the inline script puts it: a node React leaves alone (`app/author/page.tsx`). */
export const landingFrameSlotId = "author-landing-early";

export const landingFrameStyle = "position:fixed;inset:0;width:100%;height:100%;border:0;display:block;background:#4b172b;z-index:1";

export function landingFrameSrc(language: string, hash: string) {
  return `/author-landing/index.html?v=${authorLandingVersion}&lang=${language === "en" ? "en" : "ru"}${hash}`;
}

/** The same language rule as `lib/i18n/ui-language.ts`: a saved choice, else the device's first language. */
export const earlyLandingFrameScript = `(function(){try{var s=localStorage;for(var i=0;i<s.length;i++){var k=s.key(i)||'';if(/^sb-.+-auth-token$/.test(k)){var u=null;try{u=JSON.parse(s.getItem(k)||'null');u=u&&(u.user||(u.currentSession&&u.currentSession.user))}catch(e){u={}}if(u&&!u.is_anonymous)return}}if(location.hash.indexOf('invite=')>=0)return;var p=s.getItem('boks-ui-language'),d=String((navigator.languages&&navigator.languages[0])||navigator.language||'').toLowerCase().split(/[-_]/)[0],l=p==='ru'||p==='en'?p:(d==='ru'?'ru':'en'),f=document.createElement('iframe');f.id=${JSON.stringify(landingFrameId)};f.title=l==='ru'?'boks для авторов':'boks for authors';f.allow='autoplay';f.style.cssText=${JSON.stringify(landingFrameStyle)};f.src='/author-landing/index.html?v=${authorLandingVersion}&lang='+l+location.hash;(document.getElementById('author-landing-early')||document.body).appendChild(f)}catch(e){}})();`;

/** The cabinet, or the invitation, is what this account sees: an early frame must not cover it. */
export function dropUnclaimedLandingFrame() {
  const frame = typeof document === "undefined" ? null : document.getElementById(landingFrameId);
  if (frame && !frame.dataset.claimed) frame.remove();
}
