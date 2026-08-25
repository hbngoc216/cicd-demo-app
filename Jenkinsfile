pipeline {
    agent any

    environment {
        AWS_REGION = 'ap-southeast-1'
        ECR_REPO_NAME = 'bn-ecr-demo-app'

        AWS_ACCESS_KEY_ID =
            credentials('aws-access-key-id')

        AWS_SECRET_ACCESS_KEY =
            credentials('aws-secret-access-key')
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Prepare Image') {
            steps {
                script {
                    env.AWS_ACCOUNT_ID = sh(
                        script: '''
                            aws sts get-caller-identity \
                            --query Account \
                            --output text
                        ''',
                        returnStdout: true
                    ).trim()

                    env.ECR_REGISTRY =
                        "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

                    env.IMAGE_TAG = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_URI =
                        "${ECR_REGISTRY}/${ECR_REPO_NAME}:${IMAGE_TAG}"

                    echo "Image: ${IMAGE_URI}"
                }
            }
        }

        stage('Docker Build') {
            steps {
                sh '''
                    docker build -t $IMAGE_URI .
                '''
            }
        }

        stage('Login ECR') {
            steps {
                sh '''
                    aws ecr get-login-password \
                        --region $AWS_REGION \
                    | docker login \
                        --username AWS \
                        --password-stdin $ECR_REGISTRY
                '''
            }
        }

        stage('Push ECR') {
            steps {
                sh '''
                    docker push $IMAGE_URI
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
                        kubectl create namespace staging \
                          --dry-run=client \
                          -o yaml \
                        | kubectl apply -f -

                        kubectl delete secret ecr-secret \
                          -n staging \
                          --ignore-not-found

                        kubectl create secret docker-registry ecr-secret \
                          -n staging \
                          --docker-server=$ECR_REGISTRY \
                          --docker-username=AWS \
                          --docker-password="$(aws ecr get-login-password \
                          --region $AWS_REGION)"

                        sed "s|IMAGE_URI|$IMAGE_URI|g" \
                          k8s/staging/deployment.yaml \
                        | kubectl apply -f -

                        kubectl apply \
                          -f k8s/staging/service.yaml

                        kubectl rollout status \
                          deployment/demo-app \
                          -n staging \
                          --timeout=120s
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
                        POD=$(kubectl get pods \
                          -n staging \
                          -l app=demo-app \
                          -o jsonpath='{.items[0].metadata.name}')

                        kubectl exec \
                          -n staging \
                          $POD \
                          -- wget -qO- \
                          http://127.0.0.1:3000/health
                    '''
                }
            }
        }

        stage('Manual Approval') {
            steps {
                input(
                    message:
                      'Staging passed. Deploy to Production?',
                    ok:
                      'Deploy Production'
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
                        kubectl create namespace production \
                          --dry-run=client \
                          -o yaml \
                        | kubectl apply -f -

                        kubectl delete secret ecr-secret \
                          -n production \
                          --ignore-not-found

                        kubectl create secret docker-registry ecr-secret \
                          -n production \
                          --docker-server=$ECR_REGISTRY \
                          --docker-username=AWS \
                          --docker-password="$(aws ecr get-login-password \
                          --region $AWS_REGION)"

                        PREVIOUS_IMAGE=$(kubectl get deployment \
                          demo-app \
                          -n production \
                          -o jsonpath='{.spec.template.spec.containers[0].image}' \
                          2>/dev/null || true)

                        sed "s|IMAGE_URI|$IMAGE_URI|g" \
                          k8s/production/deployment.yaml \
                        | kubectl apply -f -

                        kubectl apply \
                          -f k8s/production/service.yaml

                        set +e

                        kubectl rollout status \
                          deployment/demo-app \
                          -n production \
                          --timeout=120s

                        STATUS=$?

                        set -e

                        if [ $STATUS -ne 0 ]; then
                            echo "Deployment failed."

                            if [ -n "$PREVIOUS_IMAGE" ]; then
                                echo "Rollback to $PREVIOUS_IMAGE"

                                kubectl set image \
                                  deployment/demo-app \
                                  demo-app=$PREVIOUS_IMAGE \
                                  -n production

                                kubectl rollout status \
                                  deployment/demo-app \
                                  -n production \
                                  --timeout=120s
                            fi

                            exit 1
                        fi
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
                        kubectl get pods \
                          -n production \
                          -o wide

                        kubectl get svc \
                          -n production
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'Hybrid CI/CD Pipeline succeeded.'
        }

        failure {
            echo 'Hybrid CI/CD Pipeline failed.'
        }
    }
}
