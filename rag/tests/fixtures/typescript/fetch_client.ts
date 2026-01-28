import axios from 'axios';

interface User {
    id: string;
    name: string;
    email: string;
}

export async function fetchUserWithFetch(baseUrl: string, userId: string): Promise<User> {
    const response = await fetch(`${baseUrl}/api/users/${userId}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

export async function fetchUserWithAxios(baseUrl: string, userId: string): Promise<User> {
    const response = await axios.get(`${baseUrl}/api/users/${userId}`);
    return response.data;
}

export async function createUserWithAxios(baseUrl: string, name: string, email: string): Promise<User> {
    const response = await axios.post(`${baseUrl}/api/users`, { name, email });
    return response.data;
}

export async function notifyService(endpoint: string, message: string): Promise<void> {
    await fetch(`${endpoint}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
    });
}
