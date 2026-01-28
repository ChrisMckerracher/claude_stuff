package models

// UserRepository defines the interface for user persistence.
type UserRepository interface {
	FindByID(id string) (*User, error)
	Save(user *User) error
	Delete(id string) error
}

// User represents a user entity.
type User struct {
	ID       string
	Name     string
	Email    string
	IsActive bool
}
