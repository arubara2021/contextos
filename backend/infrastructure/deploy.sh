#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${NODE_ENV:-production}"
STACK_NAME="contextos-${ENVIRONMENT}"
TEMPLATE_FILE="${SCRIPT_DIR}/template.yaml"
S3_DEPLOY_BUCKET="contextos-deploy-${ENVIRONMENT}"
BUILD_DIR="${SCRIPT_DIR}/../dist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
  log_info "Checking prerequisites..."

  local missing=0

  if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed"
    missing=1
  fi

  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    missing=1
  fi

  if ! command -v npm &> /dev/null; then
    log_error "npm is not installed"
    missing=1
  fi

  if ! command -v zip &> /dev/null; then
    log_error "zip is not installed"
    missing=1
  fi

  if [ $missing -eq 1 ]; then
    log_error "Missing prerequisites. Aborting."
    exit 1
  fi

  if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured"
    exit 1
  fi

  local account_id
  account_id=$(aws sts get-caller-identity --query Account --output text)
  log_success "AWS Account: ${account_id}"
  log_success "Region: ${REGION}"
  log_success "Environment: ${ENVIRONMENT}"
}

validate_template() {
  log_info "Validating CloudFormation template..."

  if aws cloudformation validate-template \
    --template-body "file://${TEMPLATE_FILE}" \
    --region "${REGION}" > /dev/null 2>&1; then
    log_success "Template is valid"
  else
    log_error "Template validation failed"
    aws cloudformation validate-template \
      --template-body "file://${TEMPLATE_FILE}" \
      --region "${REGION}"
    exit 1
  fi
}

build_functions() {
  log_info "Building Lambda functions..."

  cd "${SCRIPT_DIR}/.."

  if [ ! -d "node_modules" ]; then
    log_info "Installing dependencies..."
    npm ci --production=false
  fi

  log_info "Compiling TypeScript..."
  npx tsc --project tsconfig.json

  local functions=("ingest" "retrieve" "inject" "process" "decay" "reminder")

  for func in "${functions[@]}"; do
    local func_dir="${SCRIPT_DIR}/functions/${func}"
    local func_dist="${func_dir}/dist"

    if [ ! -d "${func_dir}" ]; then
      log_warn "Function directory not found: ${func_dir}, skipping"
      continue
    fi

    log_info "Packaging function: ${func}"

    rm -rf "${func_dist}"
    mkdir -p "${func_dist}"

    if [ -f "${func_dir}/handler.ts" ]; then
      npx tsc "${func_dir}/handler.ts" \
        --outDir "${func_dist}" \
        --module commonjs \
        --target ES2022 \
        --esModuleInterop \
        --resolveJsonModule \
        --skipLibCheck \
        2>/dev/null || true
    fi

    if [ -f "${func_dir}/package.json" ]; then
      cp "${func_dir}/package.json" "${func_dist}/"
      cd "${func_dist}"
      npm ci --production 2>/dev/null || npm install --production
      cd "${SCRIPT_DIR}/.."
    fi

    local shared_modules=(
      "memory"
      "storage"
      "ingestion"
      "injection"
      "agent"
      "models"
      "types"
      "utils"
      "config.ts"
      "database.ts"
    )

    for module in "${shared_modules[@]}"; do
      local src="${BUILD_DIR}/${module}"
      local dest="${func_dist}/src/${module}"
      if [ -e "${src}" ]; then
        mkdir -p "$(dirname "${dest}")"
        cp -r "${src}" "${dest}"
      fi
    done

    cd "${func_dist}"
    zip -r "${SCRIPT_DIR}/functions/${func}/deployment.zip" . -x "*.git*" "*.DS_Store*" > /dev/null
    cd "${SCRIPT_DIR}/.."

    local zip_size
    zip_size=$(du -h "${SCRIPT_DIR}/functions/${func}/deployment.zip" | cut -f1)
    log_success "  ${func}: ${zip_size}"
  done
}

create_deploy_bucket() {
  log_info "Ensuring deploy bucket exists..."

  if aws s3api head-bucket --bucket "${S3_DEPLOY_BUCKET}" 2>/dev/null; then
    log_success "Deploy bucket exists: ${S3_DEPLOY_BUCKET}"
  else
    log_info "Creating deploy bucket: ${S3_DEPLOY_BUCKET}"
    if [ "${REGION}" = "us-east-1" ]; then
      aws s3api create-bucket --bucket "${S3_DEPLOY_BUCKET}" --region "${REGION}"
    else
      aws s3api create-bucket \
        --bucket "${S3_DEPLOY_BUCKET}" \
        --region "${REGION}" \
        --create-bucket-configuration LocationConstraint="${REGION}"
    fi
    log_success "Deploy bucket created"
  fi
}

package_template() {
  log_info "Packaging CloudFormation template..."

  aws cloudformation package \
    --template-file "${TEMPLATE_FILE}" \
    --s3-bucket "${S3_DEPLOY_BUCKET}" \
    --output-template-file "${SCRIPT_DIR}/packaged-template.yaml" \
    --region "${REGION}"

  log_success "Template packaged"
}

deploy_stack() {
  log_info "Deploying stack: ${STACK_NAME}..."

  local params_file="${SCRIPT_DIR}/params-${ENVIRONMENT}.json"
  local params_arg=""

  if [ -f "${params_file}" ]; then
    params_arg="--parameter-overrides file://${params_file}"
    log_info "Using parameters from: ${params_file}"
  else
    log_warn "No parameters file found: ${params_file}"
    log_warn "Using default parameters or environment variables"

    params_arg="--parameter-overrides \
      Environment=${ENVIRONMENT} \
      CockroachConnectionString=${COCKROACH_CONNECTION_STRING:-} \
      JwtSecret=${JWT_SECRET:-$(openssl rand -base64 32)}"
  fi

  local change_set_name="deploy-$(date +%s)"

  aws cloudformation create-change-set \
    --stack-name "${STACK_NAME}" \
    --change-set-name "${change_set_name}" \
    --template-body "file://${SCRIPT_DIR}/packaged-template.yaml" \
    ${params_arg} \
    --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
    --region "${REGION}"

  log_info "Waiting for change set to be created..."
  aws cloudformation wait change-set-create-complete \
    --stack-name "${STACK_NAME}" \
    --change-set-name "${change_set_name}" \
    --region "${REGION}" 2>/dev/null || true

  local change_set_status
  change_set_status=$(aws cloudformation describe-change-set \
    --stack-name "${STACK_NAME}" \
    --change-set-name "${change_set_name}" \
    --query "Status" \
    --output text \
    --region "${REGION}")

  if [ "${change_set_status}" = "FAILED" ]; then
    local status_reason
    status_reason=$(aws cloudformation describe-change-set \
      --stack-name "${STACK_NAME}" \
      --change-set-name "${change_set_name}" \
      --query "StatusReason" \
      --output text \
      --region "${REGION}")

    if echo "${status_reason}" | grep -q "didn't contain changes"; then
      log_info "No changes detected. Stack is up to date."
      aws cloudformation delete-change-set \
        --stack-name "${STACK_NAME}" \
        --change-set-name "${change_set_name}" \
        --region "${REGION}"
      return 0
    fi

    log_error "Change set creation failed: ${status_reason}"
    exit 1
  fi

  log_info "Change set created. Changes:"
  aws cloudformation describe-change-set \
    --stack-name "${STACK_NAME}" \
    --change-set-name "${change_set_name}" \
    --query "Changes[].{Action: Type, Resource: ResourceChange.LogicalResourceId, Type: ResourceChange.ResourceType}" \
    --output table \
    --region "${REGION}"

  aws cloudformation execute-change-set \
    --stack-name "${STACK_NAME}" \
    --change-set-name "${change_set_name}" \
    --region "${REGION}"

  log_info "Waiting for stack deployment..."
  aws cloudformation wait stack-update-complete \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" 2>/dev/null || \
  aws cloudformation wait stack-create-complete \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" 2>/dev/null || true

  log_success "Stack deployed successfully"
}

print_outputs() {
  log_info "Stack outputs:"

  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[*].{Key: OutputKey, Value: OutputValue}" \
    --output table \
    --region "${REGION}"
}

cleanup() {
  log_info "Cleaning up build artifacts..."

  rm -f "${SCRIPT_DIR}/packaged-template.yaml"

  local functions=("ingest" "retrieve" "inject" "process" "decay" "reminder")
  for func in "${functions[@]}"; do
    rm -f "${SCRIPT_DIR}/functions/${func}/deployment.zip"
    rm -rf "${SCRIPT_DIR}/functions/${func}/dist"
  done

  log_success "Cleanup complete"
}

rollback() {
  log_warn "Rolling back stack: ${STACK_NAME}..."

  aws cloudformation cancel-update-stack \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" 2>/dev/null || true

  aws cloudformation rollback-stack \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" 2>/dev/null || true

  log_warn "Rollback initiated. Check AWS Console for status."
}

status() {
  log_info "Stack status:"

  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].{Status: StackStatus, Updated: LastUpdatedTime, Created: CreationTime}" \
    --output table \
    --region "${REGION}" 2>/dev/null || log_warn "Stack not found: ${STACK_NAME}"
}

delete_stack() {
  log_warn "Deleting stack: ${STACK_NAME}..."
  read -p "Are you sure? This will delete all resources. (yes/no): " confirm

  if [ "${confirm}" != "yes" ]; then
    log_info "Aborted."
    exit 0
  fi

  aws cloudformation delete-stack \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}"

  log_info "Waiting for stack deletion..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" 2>/dev/null || true

  log_success "Stack deleted"
}

main() {
  local command="${1:-deploy}"

  case "${command}" in
    deploy)
      check_prerequisites
      validate_template
      build_functions
      create_deploy_bucket
      package_template
      deploy_stack
      print_outputs
      cleanup
      ;;
    validate)
      validate_template
      ;;
    build)
      build_functions
      ;;
    status)
      status
      ;;
    rollback)
      rollback
      ;;
    delete)
      delete_stack
      ;;
    outputs)
      print_outputs
      ;;
    *)
      echo "Usage: $0 {deploy|validate|build|status|rollback|delete|outputs}"
      exit 1
      ;;
  esac
}

trap cleanup EXIT
main "$@"