package handlers

import (
	"encoding/json"
	"net/http"
)

// GetUser retrieves a user by ID.
func GetUser(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("id")
	json.NewEncoder(w).Encode(map[string]string{"id": userID})
}

// CreateUser creates a new user.
func CreateUser(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(http.StatusCreated)
}
