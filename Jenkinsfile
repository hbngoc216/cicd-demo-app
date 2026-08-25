pipeline {
    agent any

    parameters {
        booleanParam(
            name: 'FORCE_PROD_FAILURE',
            defaultValue: false,
            description: 'Enable to intentionally fail Production and test automatic rollback'
        )
    }

    environment {
        AWS_REGION = 'ap-southeast-1'
        ECR_REPO_NAME = 'bn-ecr-demo-app'

        AWS_ACCESS_KEY_ID = credentials('aws-access-key-id')
        AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    echo "=== Installing dependencies ==="
                    npm ci
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                    echo "=== Running tests ==="
                    npm test
                '''
            }
        }

        stage('Prepare Image') {
            steps {
                script {
                    env.AWS_ACCOUNT_ID = sh(
                        script: 'aws sts get-caller-identity --query Account --output text',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()

                    env.ECR_REGISTRY = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"

                    env.ECR_REPO = "${env.ECR_REGISTRY}/${env.ECR_REPO_NAME}"

                    env.IMAGE_URI = "${env.ECR_REPO}:${env.IMAGE_TAG}"

                    echo "AWS Account: ${env.AWS_ACCOUNT_ID}"
                    echo "Image Tag: ${env.IMAGE_TAG}"
                    echo "Image URI: ${env.IMAGE_URI}"
                }
            }
        }

        stage('Docker Build') {
            steps {
                sh '''
                    echo "=== Building Docker image ==="

                    docker build \
                      -t "$IMAGE_URI" \
                      .
                '''
            }
        }

        stage('Login ECR') {
            steps {
                sh '''
                    echo "=== Login to Amazon ECR ==="

                    set +x

                    aws ecr get-login-password \
                      --region "$AWS_REGION" \
                    | docker login \
                      --username AWS \
                      --password-stdin \
                      "$ECR_REGISTRY"

                    set -x
                '''
            }
        }

        stage('Push ECR') {
            steps {
                sh '''
                    echo "=== Pushing image to ECR ==="

                    docker push "$IMAGE_URI"
                '''
            }
        }

        stage('Deploy Staging') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'kubeconfig',
                        variable: 'KUBECONFIG'
                    )
                ]) {
                    sh '''
                        echo "======================================"
                        echo "Deploying to Staging"
                        echo "======================================"

                        kubectl create namespace staging \
                          --dry-run=client \
                          -o yaml \
                        | kubectl apply -f -

                        echo "Refreshing Staging ECR secret..."

                        set +x

                        ECR_PASSWORD=$(aws ecr get-login-password \
                          --region "$AWS_REGION")

                        kubectl delete secret ecr-secret \
                          -n staging \
                          --ignore-not-found

                        kubectl create secret docker-registry ecr-secret \
                          -n staging \
                          --docker-server="$ECR_REGISTRY" \
                          --docker-username=AWS \
                          --docker-password="$ECR_PASSWORD"

                        unset ECR_PASSWORD

                        set -x

                        sed "s|IMAGE_URI|$IMAGE_URI|g" \
                          k8s/staging/deployment.yaml \
                        | kubectl apply -f -

                        kubectl apply \
                          -f k8s/staging/service.yaml

                        kubectl rollout status \
                          deployment/demo-app \
                          -n staging \
                          --timeout=300s
                    '''
                }
            }
        }

        stage('Staging Health Check') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'kubeconfig',
                        variable: 'KUBECONFIG'
                    )
                ]) {
                    sh '''
                        echo "======================================"
                        echo "Staging Health Check"
                        echo "======================================"

                        kubectl rollout status \
                          deployment/demo-app \
                          -n staging \
                          --timeout=300s

                        POD=$(kubectl get pods \
                          -n staging \
                          -l app=demo-app \
                          --field-selector=status.phase=Running \
                          --sort-by=.metadata.creationTimestamp \
                          -o custom-columns=NAME:.metadata.name \
                          --no-headers \
                        | tail -n 1)

                        if [ -z "$POD" ]; then
                            echo "ERROR: No running demo-app pod found"
                            exit 1
                        fi

                        echo "Selected Pod: $POD"

                        kubectl wait \
                          --for=condition=Ready \
                          pod/"$POD" \
                          -n staging \
                          --timeout=120s

                        echo "Testing /health..."

                        kubectl exec \
                          -n staging \
                          "$POD" \
                          -c demo-app \
                          -- wget -qO- \
                          http://127.0.0.1:3000/health

                        echo ""
                        echo "Staging health check PASSED"
                    '''
                }
            }
        }

        stage('Manual Approval') {
            steps {
                input(
                    message: 'Staging passed. Deploy to Production?',
                    ok: 'Deploy Production'
                )
            }
        }

        stage('Deploy Production') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'kubeconfig',
                        variable: 'KUBECONFIG'
                    )
                ]) {
                    sh '''
                        echo "======================================"
                        echo "Deploying to Production"
                        echo "======================================"

                        kubectl create namespace production \
                          --dry-run=client \
                          -o yaml \
                        | kubectl apply -f -

                        echo "Refreshing Production ECR secret..."

                        set +x

                        ECR_PASSWORD=$(aws ecr get-login-password \
                          --region "$AWS_REGION")

                        kubectl delete secret ecr-secret \
                          -n production \
                          --ignore-not-found

                        kubectl create secret docker-registry ecr-secret \
                          -n production \
                          --docker-server="$ECR_REGISTRY" \
                          --docker-username=AWS \
                          --docker-password="$ECR_PASSWORD"

                        unset ECR_PASSWORD

                        set -x

                        echo "Current Production image:"

                        CURRENT_IMAGE=$(kubectl get deployment demo-app \
                          -n production \
                          -o jsonpath='{.spec.template.spec.containers[0].image}' \
                          2>/dev/null || true)

                        echo "$CURRENT_IMAGE"

                        PRODUCTION_IMAGE="$IMAGE_URI"

                        if [ "$FORCE_PROD_FAILURE" = "true" ]; then

                            echo "======================================"
                            echo "AUTOMATIC ROLLBACK DEMO MODE"
                            echo "Using intentionally invalid image"
                            echo "======================================"

                            PRODUCTION_IMAGE="${ECR_REPO}:rollback-test-broken"
                        fi

                        echo "New Production image:"
                        echo "$PRODUCTION_IMAGE"

                        sed "s|IMAGE_URI|$PRODUCTION_IMAGE|g" \
                          k8s/production/deployment.yaml \
                        | kubectl apply -f -

                        kubectl apply \
                          -f k8s/production/service.yaml

                        echo "Waiting for Production rollout..."

                        set +e

                        kubectl rollout status \
                          deployment/demo-app \
                          -n production \
                          --timeout=300s

                        ROLLOUT_STATUS=$?

                        set -e

                        if [ "$ROLLOUT_STATUS" -ne 0 ]; then

                            echo "======================================"
                            echo "PRODUCTION DEPLOYMENT FAILED"
                            echo "STARTING AUTOMATIC ROLLBACK"
                            echo "======================================"

                            echo "=== Production Pods ==="

                            kubectl get pods \
                              -n production \
                              -o wide || true

                            echo "=== Recent Events ==="

                            kubectl get events \
                              -n production \
                              --sort-by=.lastTimestamp \
                            | tail -30 || true

                            echo "=== Deployment History ==="

                            kubectl rollout history \
                              deployment/demo-app \
                              -n production || true

                            echo "======================================"
                            echo "Rolling back..."
                            echo "======================================"

                            kubectl rollout undo \
                              deployment/demo-app \
                              -n production

                            echo "Waiting for rollback..."

                            set +e

                            kubectl rollout status \
                              deployment/demo-app \
                              -n production \
                              --timeout=300s

                            ROLLBACK_STATUS=$?

                            set -e

                            if [ "$ROLLBACK_STATUS" -ne 0 ]; then

                                echo "======================================"
                                echo "ROLLBACK FAILED"
                                echo "======================================"

                                kubectl get pods \
                                  -n production \
                                  -o wide || true

                                exit 2
                            fi

                            echo "======================================"
                            echo "ROLLBACK SUCCESSFUL"
                            echo "======================================"

                            ROLLED_BACK_IMAGE=$(kubectl get deployment demo-app \
                              -n production \
                              -o jsonpath='{.spec.template.spec.containers[0].image}')

                            echo "Production restored to:"
                            echo "$ROLLED_BACK_IMAGE"

                            kubectl get pods \
                              -n production \
                              -o wide

                            echo ""
                            echo "New release FAILED but Production was restored."

                            exit 1
                        fi

                        echo "======================================"
                        echo "PRODUCTION DEPLOYMENT SUCCESSFUL"
                        echo "======================================"

                        kubectl get pods \
                          -n production \
                          -o wide
                    '''
                }
            }
        }

        stage('Verify Production') {
            steps {
                withCredentials([
                    file(
                        credentialsId: 'kubeconfig',
                        variable: 'KUBECONFIG'
                    )
                ]) {
                    sh '''
                        echo "======================================"
                        echo "Verifying Production"
                        echo "======================================"

                        kubectl rollout status \
                          deployment/demo-app \
                          -n production \
                          --timeout=300s

                        kubectl get deployment \
                          demo-app \
                          -n production

                        kubectl get pods \
                          -n production \
                          -o wide

                        echo "Production image:"

                        kubectl get deployment demo-app \
                          -n production \
                          -o jsonpath='{.spec.template.spec.containers[0].image}'

                        echo ""

                        READY=$(kubectl get deployment demo-app \
                          -n production \
                          -o jsonpath='{.status.readyReplicas}')

                        if [ "$READY" != "2" ]; then
                            echo "ERROR: Production does not have 2 ready replicas"
                            exit 1
                        fi

                        echo "======================================"
                        echo "Production verification PASSED"
                        echo "======================================"
                    '''
                }
            }
        }
    }

    post {
        success {
            echo '======================================'
            echo 'CI/CD PIPELINE SUCCESS'
            echo '======================================'
        }

        failure {
            echo '======================================'
            echo 'CI/CD PIPELINE FAILED'
            echo 'Check console output for details.'
            echo '======================================'
        }

        always {
            echo 'Pipeline finished.'
        }
    }
}
