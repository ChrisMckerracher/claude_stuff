package client

import "net/http"

func FetchUserProfile(baseURL string, userID string) (*http.Response, error) {
	return http.Get(baseURL + "/api/users/" + userID)
}

func NotifyService(endpoint string) {
	http.Post(endpoint+"/notify", "application/json", nil)
}
