# Mautic Self-Hosted Setup (7-point plan #1 — deploy-time)

**Status:** DEPLOY-TIME. Abhi ke liye Brevo free (300 emails/day) se
`digital-email-nurture.json` chal raha hai — zero setup. List badi ho ya
automation complex ho to Mautic par shift karo (unlimited contacts/emails,
self-hosted, GPL-3.0).

## Oracle VM par (deploy ke waqt)

```yaml
# deploy/docker-compose.mautic.yml (n8n ke saath)
services:
  mautic-db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MAUTIC_DB_ROOT_PASSWORD}
      MYSQL_DATABASE: mautic
      MYSQL_USER: mautic
      MYSQL_PASSWORD: ${MAUTIC_DB_PASSWORD}
    volumes: [mautic_db:/var/lib/mysql]
  mautic:
    image: mautic/mautic:5-apache
    depends_on: [mautic-db]
    environment:
      MAUTIC_DB_HOST: mautic-db
      MAUTIC_DB_USER: mautic
      MAUTIC_DB_PASSWORD: ${MAUTIC_DB_PASSWORD}
      MAUTIC_DB_NAME: mautic
    ports: ["8080:80"]
    volumes: [mautic_data:/var/www/html]
volumes:
  mautic_db:
  mautic_data:
```

RAM note: Mautic + MySQL ~1-1.5 GB — VM ke 12 GB me fit hai (steady ~3-4 GB
ke baad bhi ~7 GB bachta hai).

## n8n integration

Mautic ke Campaigns me "freebie download" segment → 3-email nurture → pitch.
`digital-email-nurture.json` ka Brevo version tab Mautic webhooks se replace
hoga (Mautic API: POST /api/contacts/new, POST /api/emails/send).

## Kyun Mautic (Brevo se behtar, jab scale ho)

- Unlimited contacts/emails (Brevo free: 300/day cap)
- Visual campaign builder, lead scoring, dynamic content
- Data tumhare VM par (koi third-party lock-in nahi)
