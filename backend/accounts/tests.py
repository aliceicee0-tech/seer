"""Tests du flux d'authentification : register → login → accès protégé.

Couvre notamment la régression create_user (Django 5.1 exige `username`
positionnel même avec USERNAME_FIELD personnalisé).
"""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()


class RegisterFlowTests(APITestCase):
    def test_register_creates_user_and_returns_jwt(self):
        """L'inscription crée un user, normalise le téléphone, renvoie un JWT."""
        url = reverse("auth:register")
        resp = self.client.post(url, {
            "phone": "+261 34 12 34 56",
            "password": "demo1234",
            "display_name": "Joueur Test",
        }, format="json")

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        self.assertIn("user", resp.data)
        # Le téléphone est normalisé en forme locale (0XXXXXXXXX).
        self.assertEqual(resp.data["user"]["phone"], "034123456")
        # Le user existe vraiment en base.
        self.assertTrue(User.objects.filter(phone="034123456").exists())

    def test_register_rejects_duplicate_phone(self):
        """On ne peut pas s'inscrire deux fois avec le même numéro."""
        User.objects.create_user(
            username="0340000099", phone="0340000099", password="x123456",
        )
        url = reverse("auth:register")
        resp = self.client.post(url, {
            "phone": "0340000099", "password": "demo1234",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_too_short_rejected(self):
        url = reverse("auth:register")
        resp = self.client.post(url, {
            "phone": "0341112233", "password": "123",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class LoginFlowTests(APITestCase):
    def test_login_returns_jwt_and_user(self):
        """Le login avec téléphone + mot de passe renvoie un JWT valide."""
        User.objects.create_user(
            username="0341234567", phone="0341234567", password="demo1234",
        )
        url = reverse("auth:login")
        resp = self.client.post(url, {
            "phone": "0341234567", "password": "demo1234",
        }, format="json")

        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertIn("access", resp.data)
        self.assertEqual(resp.data["user"]["phone"], "0341234567")

    def test_login_wrong_password_rejected(self):
        User.objects.create_user(
            username="0341234567", phone="0341234567", password="demo1234",
        )
        url = reverse("auth:login")
        resp = self.client.post(url, {
            "phone": "0341234567", "password": "WRONG",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class ProtectedAccessTests(APITestCase):
    def test_me_requires_authentication(self):
        """La route /me/ refuse l'accès sans token (401)."""
        url = reverse("accounts:me")
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_profile_with_jwt(self):
        """Un token JWT valide donne accès au profil."""
        user = User.objects.create_user(
            username="0341234567", phone="0341234567", password="demo1234",
        )
        self.client.force_authenticate(user=user)
        url = reverse("accounts:me")
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["phone"], "0341234567")
