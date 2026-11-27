(() => {
    const messages = {
        not_configured:
            "Social sign-in is not configured yet. Add the provider's client/app ID, client/app secret, and registered callback URL to the server .env file, then restart the server. Never share your app secret.",
        social_email_in_use:
            "An account already uses this email. Sign in with your password first; social sign-in will not merge accounts automatically.",
        social_email_missing:
            "The provider did not share an email address. Allow email access in your provider account and try again.",
        social_cancelled:
            "Social sign-in was cancelled. You can try again or use your email and password.",
        social_invalid_state:
            "This sign-in request expired or could not be verified. Please try again.",
        social_session_failed:
            "Your sign-in session could not be saved. Please try again.",
        social_failed:
            "Social sign-in could not be completed. Please try again."
    };
    const errorCode = new URLSearchParams(window.location.search)
        .get("authError");
    const note = document.getElementById("socialAuthNote");

    if (
        note &&
        errorCode &&
        Object.prototype.hasOwnProperty.call(messages, errorCode)
    ) {
        note.textContent = messages[errorCode];
    }
})();
