module github.com/acme/gateway

go 1.22

require (
	github.com/getsentry/sentry-go v0.28.1
	github.com/stripe/stripe-go/v76 v76.25.0
	github.com/aws/aws-sdk-go-v2 v1.30.3
	github.com/lib/pq v1.10.9
	github.com/redis/go-redis/v9 v9.6.1
)

require github.com/gin-gonic/gin v1.10.0 // indirect

replace github.com/acme/internal => ../internal
