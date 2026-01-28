package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// Config holds application configuration
type Config struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Debug    bool   `json:"debug"`
	Timeout  int    `json:"timeout"`
	MaxConns int    `json:"max_conns"`
}

// User represents a user in the system
type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
	Active    bool      `json:"active"`
}

// Service handles business logic
type Service struct {
	config Config
	cache  *redis.Client
}

// NewService creates a new service instance
func NewService(cfg Config) *Service {
	return &Service{
		config: cfg,
		cache:  nil,
	}
}

// HandleRequest processes incoming HTTP requests
func (s *Service) HandleRequest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check if request is nil
	if r == nil {
		http.Error(w, "nil request", http.StatusBadRequest)
		return
	}

	// Get user from context
	user, ok := ctx.Value("user").(User)
	if !ok {
		log.Printf("user not found in context")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Process the request
	result := map[string]interface{}{
		"status": "ok",
		"user":   user.Username,
		"admin":  false,
		"master": false,
	}

	// Handle null/nil cases
	if user.ID == "" {
		result["status"] = "error"
		result["error"] = "null user ID"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ConnectRedis establishes Redis connection
func (s *Service) ConnectRedis(ctx context.Context) error {
	s.cache = redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "", // no password for dev
		DB:       0,
	})

	// Ping to verify connection
	_, err := s.cache.Ping(ctx).Result()
	if err != nil {
		return fmt.Errorf("redis connection failed: %w", err)
	}

	log.Printf("Connected to Redis at localhost:6379")
	return nil
}

func main() {
	cfg := Config{
		Host:     "0.0.0.0",
		Port:     8080,
		Debug:    true,
		Timeout:  30,
		MaxConns: 100,
	}

	svc := NewService(cfg)

	ctx := context.Background()
	if err := svc.ConnectRedis(ctx); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	http.HandleFunc("/api/v1/status", svc.HandleRequest)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	log.Printf("Starting server on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
