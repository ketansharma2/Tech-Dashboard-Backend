# Deployment — CI/CD (GitHub Actions → ECR → EC2 via SSM)

How the Maven backend is built, shipped, and run. Read this once end-to-end
before the first deploy; after setup, day-to-day shipping is just `git push`.

## Architecture

```
  git push main                       git push dev
       │                                   │
       ▼                                   ▼
  deploy-prod.yml                     deploy-dev.yml
  (environment: production)           (environment: development)
       └──────────────┬────────────────────┘
                       ▼
          _deploy.yml (reusable)
            OIDC: assume IAM role (no stored AWS keys)
            1. docker build → push to ECR  (tag: <env>-<sha>, <env>-latest)
            2. SSM SendCommand → EC2:
                 docker login ECR
                 docker compose --env-file <.env|.env.dev> -f docker-compose.prod.yml pull
                 docker compose --env-file <.env|.env.dev> -f docker-compose.prod.yml up -d
                        │
                        ▼
                 container ENTRYPOINT:  prisma migrate deploy → node dist/main
```

### Ports

- The container listens on **8080** internally — fixed by the Docker image
  (`ENV PORT=8080`), **not** read from `.env`.
- The EC2 host publishes it on **5000** (compose `ports: '5000:8080'`). Clients
  hit `:5000`.
- **Do not put `PORT` in any `.env`** — via `env_file` it would override the image
  default and break the `5000:8080` mapping.
- **Prod + dev each run on their own EC2 instance**, so both can use `5000:8080`.
  (To co-locate on one box, change the published side, e.g. `5001:8080`.)

Two things stay **on the instance**, never in CI:
- `docker-compose.prod.yml` — copied from this repo into `/opt/maven-backend`.
- The **env file** — real DB string + JWT secrets. **Never committed, never in CI.**
  - `.env` for **production** (branch `main`)
  - `.env.dev` for **development** (branch `dev`)

CI authenticates to AWS via **OIDC** (short-lived, no `AWS_ACCESS_KEY_ID` secrets)
and deploys via **SSM Run Command** (no inbound SSH, no SSH keys).

> Compose nuance: `env_file:` injects app secrets (DB/JWT) *into the container*;
> `${IMAGE_URI}` *interpolation* in the compose file reads from the shell. CI passes
> `--env-file <file>` to select prod vs dev secrets, while the service's
> `env_file: ${ENV_FILE}` points at the same file. Ports are NOT interpolated —
> they're hardcoded in the compose file.

---

## One-time AWS setup

Set these shell vars first (used in the commands below):

```bash
export AWS_REGION=ap-south-1            # your region
export ACCOUNT_ID=123456789012          # aws sts get-caller-identity --query Account --output text
export ECR_REPO=maven-dashboard/production   # dev would be maven-dashboard/development
export GH_OWNER=your-github-username-or-org
export GH_REPO=your-backend-repo-name   # the repo you push (see "Git remote" below)
```

### 1. Create the ECR repository

```bash
aws ecr create-repository \
  --repository-name "$ECR_REPO" \
  --region "$AWS_REGION" \
  --image-scanning-configuration scanOnPush=true
```

### 2. Register GitHub as an OIDC identity provider (once per AWS account)

Skip if you already have `token.actions.githubusercontent.com` under IAM →
Identity providers.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 3. IAM role assumed by GitHub Actions

**Trust policy** — `gha-trust.json`. The `sub` condition locks this role to your
repo *and* the named GitHub Environments:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": [
          "repo:GH_OWNER/GH_REPO:environment:production"
        ]
      }
    }
  }]
}
```

> When you add a dev environment, append `"repo:GH_OWNER/GH_REPO:environment:development"`
> to that `sub` list and update the role.

**Permissions policy** — `gha-perms.json` (push to ECR + deploy via SSM):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "EcrAuth", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    {
      "Sid": "EcrPushPull",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:AWS_REGION:ACCOUNT_ID:repository/maven-dashboard/*"
    },
    {
      "Sid": "SsmDeploy",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:AWS_REGION::document/AWS-RunShellScript",
        "arn:aws:ec2:AWS_REGION:ACCOUNT_ID:instance/*"
      ]
    },
    {
      "Sid": "SsmReadResult",
      "Effect": "Allow",
      "Action": ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
      "Resource": "*"
    }
  ]
}
```

> Replace `ACCOUNT_ID`, `AWS_REGION`, `GH_OWNER`, `GH_REPO`. Tighten `instance/*`
> to your specific instance ARN once you have its ID.

Create the role and note its ARN:

```bash
aws iam create-role --role-name maven-gha-deploy \
  --assume-role-policy-document file://gha-trust.json
aws iam put-role-policy --role-name maven-gha-deploy \
  --policy-name maven-gha-deploy --policy-document file://gha-perms.json
aws iam get-role --role-name maven-gha-deploy --query Role.Arn --output text   # → AWS_ROLE_ARN
```

### 4. IAM role for the EC2 instance (pull from ECR + receive SSM)

```bash
cat > ec2-trust.json <<'JSON'
{ "Version": "2012-10-17", "Statement": [{
    "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole" }] }
JSON

aws iam create-role --role-name maven-ec2-role \
  --assume-role-policy-document file://ec2-trust.json
aws iam attach-role-policy --role-name maven-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam attach-role-policy --role-name maven-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

aws iam create-instance-profile --instance-profile-name maven-ec2-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name maven-ec2-profile --role-name maven-ec2-role
```

Attach `maven-ec2-profile` to your EC2 instance.

### 5. Provision the EC2 instance

Use **Ubuntu 22.04/24.04** (or Amazon Linux 2023). Security group: inbound
**5000** (the published host port) from your clients/load balancer, outbound
all. **No SSH rule needed** — administer it via SSM Session Manager.

Session-Manager in once and run:

```bash
# --- Docker engine + compose plugin ---
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# --- AWS CLI v2 (the SSM deploy script calls `aws ecr get-login-password`) ---
sudo apt-get update && sudo apt-get install -y unzip
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
unzip -q /tmp/awscli.zip -d /tmp && sudo /tmp/aws/install

# --- SSM agent (preinstalled on AWS Ubuntu/AL2023 AMIs; confirm it runs) ---
sudo systemctl enable --now amazon-ssm-agent || sudo snap start amazon-ssm-agent

# --- Deploy directory ---
sudo mkdir -p /opt/maven-backend && sudo chown ubuntu:ubuntu /opt/maven-backend
```

Place two files in `/opt/maven-backend`:

1. **`docker-compose.prod.yml`** — copy it from this repo. (Re-copy when it changes.)

2. **The env file** — for a **production** box create **`.env`** from `.env.example`
   with real values (for a dev box, name it **`.env.dev`**):
   ```bash
   cd /opt/maven-backend
   # minimally (do NOT set PORT — it's baked into the image as 8080):
   #   CORS_ORIGINS=https://app.mavenjobs.com     # set for prod (main.ts reads it)
   #   TECH_DB_CONNECTION_STRING=postgresql://...:6543/...?sslmode=require
   #   JWT_ACCESS_SECRET=...   JWT_REFRESH_SECRET=...   (openssl rand -base64 48)
   chmod 600 .env        # or .env.dev
   ```

Verify SSM sees the instance: `aws ssm describe-instance-information`.

---

## One-time GitHub setup

### Git remote (none exists yet)

`backend/` is currently its own git repo on branch `main_omkar` with **no remote**.
Create a GitHub repo and push:

```bash
cd backend
git remote add origin https://github.com/GH_OWNER/GH_REPO.git
git branch -M main                 # the prod workflow triggers on `main`
git push -u origin main
```

### Environment + variables

GitHub → **Settings → Environments → New environment** → name it **`production`**.
Under that environment add these **Variables** (not secrets — none are sensitive):

| Variable          | Value                                              |
|-------------------|----------------------------------------------------|
| `AWS_REGION`      | `ap-south-1`                                        |
| `AWS_ROLE_ARN`    | ARN from step 3 (`maven-gha-deploy`)                |
| `ECR_REPOSITORY`  | `maven-dashboard/production`                        |
| `EC2_INSTANCE_ID` | `i-0123...` of your prod instance                   |
| `DEPLOY_PATH`     | `/opt/maven-backend` (optional; this is the default)|

**No repository secrets required.** OIDC handles AWS auth; the DB/JWT secrets live
only in the instance's env file.

---

## Shipping

- **Deploy prod:** push to `main`. `CI` runs (lint + build + test), then
  `Deploy · production` builds the image, pushes to ECR, and rolls it onto EC2
  using `.env`, published on host port 5000.
- **Deploy dev:** push to `dev` (once the dev environment exists). Uses `.env.dev`.
- **Manual deploy / re-run:** Actions tab → *Deploy · …* → *Run workflow*.

### Rollback

Every push is tagged `<env>-<sha>` in ECR, so rollback = redeploy an old tag.
Run on the instance via SSM Session Manager:

```bash
cd /opt/maven-backend
export IMAGE_URI=ACCOUNT_ID.dkr.ecr.AWS_REGION.amazonaws.com/maven-dashboard/production:prod-<old-sha>
export COMPOSE_PROJECT_NAME=maven-prod
aws ecr get-login-password --region AWS_REGION | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.AWS_REGION.amazonaws.com
docker compose --env-file .env -f docker-compose.prod.yml up -d
# (for dev: prod-<sha> -> dev-<sha>, maven-prod -> maven-dev, --env-file .env.dev)
```

---

## Adding a `dev` environment later

`deploy-dev.yml` is already scaffolded, triggers on the `dev` branch, and deploys
with `.env.dev`. To activate it:

1. Stand up a dev EC2 instance (steps 4–5) and create `.env.dev` on it. It also
   publishes on host 5000 (separate box, so no clash), and create the dev ECR repo
   `maven-dashboard/development`.
2. Add `"repo:GH_OWNER/GH_REPO:environment:development"` to the role trust `sub`
   list (step 3) and update the role.
3. Create a **`development`** GitHub Environment with the same five variables,
   pointing `EC2_INSTANCE_ID` at the dev box.
4. `git push` to the `dev` branch.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| OIDC: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` doesn't match `repo:OWNER/REPO:environment:<env>`. Check repo name + that the job declares the right `environment`. |
| ECR `denied` on push | `gha-perms.json` repository ARN/region wrong, or repo not created. |
| SSM command stuck `Pending` / instance not targetable | SSM agent not running, or instance profile missing `AmazonSSMManagedInstanceCore`. `aws ssm describe-instance-information`. |
| Remote `docker: command not found` / `aws: command not found` | Docker or AWS CLI v2 not installed on the instance (step 5). |
| App not reachable on :5000 | Security group missing inbound 5000. |
| Healthcheck failing / app on wrong port | `PORT` is set in a `.env` and overriding the image's 8080 — remove it. |
| Container restarts; logs show Prisma migrate error | DB unreachable / `TECH_DB_CONNECTION_STRING` wrong in the env file. `docker compose -f docker-compose.prod.yml logs -f`. |
