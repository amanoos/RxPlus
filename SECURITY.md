# Security

RxPlus holds personal health information (who takes which medications), so security reports are welcome and taken seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it.

You'll get a reply within a week. Once it's fixed, you'll be credited in the fix unless you'd rather not be.

## Scope

RxPlus is built to run on a home network, not the open internet (see the README). Reports are most useful about:

- signing in, sessions, accounts and the admin command (`dist/user.cjs`);
- one account reading or changing another account's data;
- injection or cross-site scripting in any page or API route;
- secrets or health data leaking into logs, responses or the repository.

Running it exposed to the internet without HTTPS and a firewall is outside what it's designed for; see "Use it from your phone or tablet" in the README.

## Supported versions

Only the latest `main` is supported. Updates are applied by pulling `main` and rebuilding (README, "Keep it running and up to date").
