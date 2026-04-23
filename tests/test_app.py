import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_index_route(client):
    response = client.get('/')
    assert response.status_code == 200
    assert 'ANONYMOUS CHAT TERMINAL' in response.data.decode('utf-8')

def test_generate_user_id():
    from app import generate_user_id
    user_id = generate_user_id()
    assert len(user_id) == 8
    assert user_id.isalnum()

def test_sanitize_message():
    from app import sanitize_message
    assert sanitize_message('<script>alert("xss")</script>') == '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    assert sanitize_message('Hello < World >') == 'Hello &lt; World &gt;'

def test_online_users_initial_empty():
    from app import online_users
    assert isinstance(online_users, dict)

def test_messages_initial_empty():
    from app import messages
    assert isinstance(messages, list)

if __name__ == '__main__':
    pytest.main([__file__, '-v'])