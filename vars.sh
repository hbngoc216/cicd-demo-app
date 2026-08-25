#!/bin/bash

export APP_NAME="demo-app"
export IMAGE_TAG="v1"

export AWS_REGION="ap-southeast-1"

export AWS_ACCOUNT_ID="475309741409"

export ECR_REPO_NAME="bn-ecr-demo-app"
export ECR_REGISTRY="475309741409.dkr.ecr.ap-southeast-1.amazonaws.com"
export ECR_REPO="${ECR_REGISTRY}/${ECR_REPO_NAME}"

export STAGING_NAMESPACE="staging"
export PRODUCTION_NAMESPACE="production"
export MONITORING_NAMESPACE="monitoring"

export APP_PORT="3000"
export STAGING_NODEPORT="30080"
export PRODUCTION_NODEPORT="30081"
