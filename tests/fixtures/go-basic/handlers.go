package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func listCustomers(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"customers": []string{}})
}

func createCharge(c *gin.Context) {
	resp, err := http.Get("https://api.stripe.com/v1/charges")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func verifyToken(tokenString string) error {
	_, err := jwt.Parse(tokenString, nil)
	return err
}
